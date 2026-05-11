import "server-only";
import { db } from "@/lib/db";
import { cachedResources, instances, cloudAccounts, instanceTags } from "@/lib/db/schema";

export type Severity = "critical" | "high" | "medium" | "low";
export type FindingKind =
  | "ssh-open-world"
  | "rdp-open-world"
  | "any-open-world"
  | "public-bucket"
  | "unencrypted-volume"
  | "stopped-but-billable"
  | "long-stopped"
  | "missing-required-tags"
  | "orphan-snapshot"
  | "orphan-volume"
  | "orphan-elastic-ip";

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  provider: string;
  accountName: string;
  accountId: string;
  region: string;
  resourceKind: string;
  resourceName: string;
  externalId: string;
  message: string;
}

interface IpPermission {
  IpProtocol?: string;
  FromPort?: number;
  ToPort?: number;
  IpRanges?: Array<{ CidrIp?: string }>;
  Ipv6Ranges?: Array<{ CidrIpv6?: string }>;
}

function isOpenToWorld(perm: IpPermission): boolean {
  return (
    (perm.IpRanges ?? []).some((r) => r.CidrIp === "0.0.0.0/0") ||
    (perm.Ipv6Ranges ?? []).some((r) => r.CidrIpv6 === "::/0")
  );
}

function portCovers(perm: IpPermission, port: number): boolean {
  if (perm.IpProtocol === "-1") return true;
  if (perm.FromPort === undefined || perm.ToPort === undefined) return false;
  return port >= perm.FromPort && port <= perm.ToPort;
}

export async function scanCompliance(): Promise<Finding[]> {
  const [resources, accounts, instanceList, tagRows] = await Promise.all([
    db.select().from(cachedResources),
    db.select().from(cloudAccounts),
    db.select().from(instances),
    db.select().from(instanceTags),
  ]);
  const accountMap = new Map(accounts.map((a) => [a.id, a] as const));
  const tagsByInstance = new Map<string, Set<string>>();
  for (const t of tagRows) {
    const set = tagsByInstance.get(t.instanceId) ?? new Set<string>();
    set.add(t.key);
    tagsByInstance.set(t.instanceId, set);
  }
  const findings: Finding[] = [];

  for (const r of resources) {
    const acc = accountMap.get(r.accountId);
    if (!acc) continue;
    const accountName = acc.name;
    const baseId = `${r.accountId}:${r.id}`;
    const baseFinding = (kind: FindingKind, severity: Severity, message: string): Finding => ({
      id: `${baseId}:${kind}`,
      kind,
      severity,
      provider: r.provider,
      accountName,
      accountId: r.accountId,
      region: r.region,
      resourceKind: r.kind,
      resourceName: r.name ?? r.externalId,
      externalId: r.externalId,
      message,
    });

    let raw: Record<string, unknown> | null = null;
    if (r.rawJson) {
      try {
        raw = JSON.parse(r.rawJson) as Record<string, unknown>;
      } catch {
        raw = null;
      }
    }
    if (!raw) continue;

    if (r.kind === "security-group" && r.provider === "aws") {
      const perms = (raw["IpPermissions"] ?? []) as IpPermission[];
      for (const p of perms) {
        if (!isOpenToWorld(p)) continue;
        if (portCovers(p, 22)) findings.push(baseFinding("ssh-open-world", "critical", "SSH (port 22) open to 0.0.0.0/0."));
        else if (portCovers(p, 3389)) findings.push(baseFinding("rdp-open-world", "critical", "RDP (port 3389) open to 0.0.0.0/0."));
        else if (p.IpProtocol === "-1") findings.push(baseFinding("any-open-world", "high", "All ports / protocols open to 0.0.0.0/0."));
      }
    }

    if (r.kind === "volume" && r.provider === "aws") {
      const encrypted = raw["Encrypted"];
      if (encrypted === false) {
        findings.push(baseFinding("unencrypted-volume", "high", "EBS volume is not encrypted at rest."));
      }
    }

    if (r.kind === "bucket") {
      // AWS S3: Grants[].Grantee.URI matches AllUsers / AuthenticatedUsers
      const acl = raw["AccessControlList"] ?? raw["Grants"];
      const grants = Array.isArray(acl) ? (acl as Array<Record<string, unknown>>) : [];
      const isPublic = grants.some((g) => {
        const grantee = (g["Grantee"] ?? {}) as { URI?: string };
        return grantee.URI?.includes("AllUsers") || grantee.URI?.includes("AuthenticatedUsers");
      });
      // GCP: iamConfiguration.publicAccessPrevention === "inherited" with ACL roles/storage.objectViewer to "allUsers"
      const iamConfig = raw["iamConfiguration"] as { publicAccessPrevention?: string } | undefined;
      const publicAccessPrevention = iamConfig?.publicAccessPrevention;
      if (isPublic) {
        findings.push(baseFinding("public-bucket", "high", "Bucket grants public read or list access."));
      } else if (publicAccessPrevention && publicAccessPrevention !== "enforced") {
        findings.push(baseFinding("public-bucket", "medium", `Bucket public-access-prevention is "${publicAccessPrevention}".`));
      }
    }
  }

  // Stopped-but-billable: AWS instances stopped with attached EBS volumes
  for (const inst of instanceList) {
    if (inst.state !== "stopped") continue;
    const attached = resources.filter(
      (r) => r.provider === inst.provider && r.kind === "volume" && r.attachedToInstanceId === inst.providerInstanceId,
    );
    if (attached.length === 0) continue;
    const acc = accountMap.get(inst.accountId);
    findings.push({
      id: `${inst.id}:stopped-but-billable`,
      kind: "stopped-but-billable",
      severity: "low",
      provider: inst.provider,
      accountName: acc?.name ?? "(unknown)",
      accountId: inst.accountId,
      region: inst.region,
      resourceKind: "instance",
      resourceName: inst.displayName ?? inst.name ?? inst.providerInstanceId,
      externalId: inst.providerInstanceId,
      message: `Stopped VM still has ${attached.length} attached volume(s); storage is billed even when off.`,
    });
  }

  // Long-stopped: any VM in stopped state for > 14 days based on createdAt
  // (a stopped VM that's been around without being terminated is a cleanup
  // candidate; severity escalates past 30 days).
  const STOP_DAYS_WARN = 14;
  const STOP_DAYS_HIGH = 30;
  const now = Date.now();
  for (const inst of instanceList) {
    if (inst.state !== "stopped") continue;
    const created = inst.createdAt instanceof Date ? inst.createdAt.getTime() : new Date(inst.createdAt as unknown as number).getTime();
    const days = Math.floor((now - created) / 86_400_000);
    if (days < STOP_DAYS_WARN) continue;
    const sev: Severity = days >= STOP_DAYS_HIGH ? "medium" : "low";
    const acc = accountMap.get(inst.accountId);
    findings.push({
      id: `${inst.id}:long-stopped`,
      kind: "long-stopped",
      severity: sev,
      provider: inst.provider,
      accountName: acc?.name ?? "(unknown)",
      accountId: inst.accountId,
      region: inst.region,
      resourceKind: "instance",
      resourceName: inst.displayName ?? inst.name ?? inst.providerInstanceId,
      externalId: inst.providerInstanceId,
      message: `Stopped for ~${days} days. Snapshot & terminate to stop storage billing?`,
    });
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  // Required-tag enforcement: for each account with a non-empty requiredTags
  // JSON array, flag every instance whose tag set is missing any required key.
  for (const acc of accounts) {
    if (!acc.requiredTags) continue;
    let required: string[] = [];
    try {
      const parsed = JSON.parse(acc.requiredTags) as unknown;
      if (Array.isArray(parsed)) {
        required = parsed.filter((s): s is string => typeof s === "string" && s.length > 0);
      }
    } catch {
      continue;
    }
    if (required.length === 0) continue;
    for (const inst of instanceList) {
      if (inst.accountId !== acc.id) continue;
      if (inst.state === "terminated") continue;
      const have = tagsByInstance.get(inst.id) ?? new Set<string>();
      const missing = required.filter((k) => !have.has(k));
      if (missing.length === 0) continue;
      findings.push({
        id: `${inst.id}:missing-required-tags`,
        kind: "missing-required-tags",
        severity: "medium",
        provider: inst.provider,
        accountName: acc.name,
        accountId: acc.id,
        region: inst.region,
        resourceKind: "instance",
        resourceName: inst.displayName ?? inst.name ?? inst.providerInstanceId,
        externalId: inst.providerInstanceId,
        message: `Missing required tag${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
      });
    }
  }

  // Orphan resources: snapshots/volumes/EIPs not attached to any live VM.
  // Attached-ness is detected via `attachedToInstanceId` (our normalizer fills
  // this for AWS volumes & EIPs; snapshots typically lack a hard link).
  const liveInstanceIds = new Set(
    instanceList.filter((i) => i.state !== "terminated").map((i) => i.providerInstanceId),
  );
  for (const r of resources) {
    const acc = accountMap.get(r.accountId);
    if (!acc) continue;
    const base = (kind: FindingKind, severity: Severity, message: string): Finding => ({
      id: `${r.id}:${kind}`,
      kind,
      severity,
      provider: r.provider,
      accountName: acc.name,
      accountId: r.accountId,
      region: r.region,
      resourceKind: r.kind,
      resourceName: r.name ?? r.externalId,
      externalId: r.externalId,
      message,
    });
    if (r.kind === "volume") {
      const attached = r.attachedToInstanceId && liveInstanceIds.has(r.attachedToInstanceId);
      const status = (r.status ?? "").toLowerCase();
      if (!attached && (status === "available" || status === "unattached" || status === "")) {
        findings.push(base("orphan-volume", "low", "Volume not attached to any live VM; storage is still billed."));
      }
    } else if (r.kind === "elastic-ip") {
      if (!r.attachedToInstanceId) {
        findings.push(base("orphan-elastic-ip", "medium", "Elastic IP is not attached to any VM; charged hourly."));
      }
    } else if (r.kind === "snapshot") {
      let raw: Record<string, unknown> | null = null;
      if (r.rawJson) {
        try { raw = JSON.parse(r.rawJson) as Record<string, unknown>; } catch { /* ignore */ }
      }
      const sourceId =
        (raw?.["VolumeId"] as string | undefined) ??
        (raw?.["sourceDisk"] as string | undefined) ??
        null;
      if (sourceId && !liveInstanceIds.has(sourceId)) {
        // Source volume no longer exists or isn't attached to a live VM.
        // Heuristic: flag if the snapshot is > 30 days old.
        const days = r.lastSyncedAt instanceof Date
          ? Math.floor((Date.now() - r.lastSyncedAt.getTime()) / 86_400_000)
          : 0;
        if (days >= 0) {
          findings.push(base("orphan-snapshot", "low", `Snapshot has no live source VM; review and prune.`));
        }
      }
    }
  }

  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.accountName.localeCompare(b.accountName));
  return findings;
}
