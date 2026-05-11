import "server-only";
import { db } from "@/lib/db";
import { instances, cachedResources, cloudAccounts } from "@/lib/db/schema";

export type TopologyNodeKind =
  | "account"
  | "instance"
  | "volume"
  | "snapshot"
  | "security-group"
  | "vpc"
  | "subnet"
  | "bucket"
  | "load-balancer"
  | "database"
  | "dns";

export interface TopologyNode {
  id: string;
  kind: TopologyNodeKind;
  label: string;
  provider: string;
  accountId: string;
  region: string;
  status?: string | null;
  meta?: Record<string, string | number | undefined>;
}

export interface TopologyEdge {
  from: string;
  to: string;
  kind: "attaches" | "in-group" | "in-vpc" | "in-subnet" | "owned-by";
}

export interface TopologyData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  generatedAt: number;
}

const KIND_MAP: Record<string, TopologyNodeKind> = {
  volume: "volume",
  snapshot: "snapshot",
  "security-group": "security-group",
  sg: "security-group",
  vpc: "vpc",
  network: "vpc",
  subnet: "subnet",
  bucket: "bucket",
  storage: "bucket",
  "load-balancer": "load-balancer",
  lb: "load-balancer",
  database: "database",
  db: "database",
  rds: "database",
  dns: "dns",
};

function parseJson<T = unknown>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export async function loadTopology(): Promise<TopologyData> {
  const [accounts, insts, resources] = await Promise.all([
    db.select().from(cloudAccounts),
    db.select().from(instances),
    db.select().from(cachedResources),
  ]);

  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  for (const acc of accounts) {
    nodes.push({
      id: `acc:${acc.id}`,
      kind: "account",
      label: acc.name,
      provider: acc.provider,
      accountId: acc.id,
      region: acc.defaultRegion ?? "",
    });
  }

  for (const i of insts) {
    nodes.push({
      id: i.id,
      kind: "instance",
      label: i.name ?? i.providerInstanceId,
      provider: i.provider,
      accountId: i.accountId,
      region: i.region,
      status: i.state,
      meta: { instanceType: i.instanceType ?? "", platform: i.platform },
    });
    edges.push({ from: i.id, to: `acc:${i.accountId}`, kind: "owned-by" });
  }

  const externalIdToNodeId = new Map<string, string>();

  for (const r of resources) {
    const kind = KIND_MAP[r.kind] ?? null;
    if (!kind) continue;
    const id = r.id;
    nodes.push({
      id,
      kind,
      label: r.name ?? r.externalId,
      provider: r.provider,
      accountId: r.accountId,
      region: r.region,
      status: r.status,
      meta: { sizeBytes: r.sizeBytes ?? undefined, monthlyUsd: r.monthlyUsd ?? undefined },
    });
    externalIdToNodeId.set(`${r.accountId}:${r.region}:${r.externalId}`, id);
    edges.push({ from: id, to: `acc:${r.accountId}`, kind: "owned-by" });
    if (r.attachedToInstanceId) {
      edges.push({ from: id, to: r.attachedToInstanceId, kind: "attaches" });
    }
  }

  // Try to discover VPC membership for subnets from rawJson fields.
  for (const r of resources) {
    if (r.kind !== "subnet") continue;
    const raw = parseJson<{ VpcId?: string; vpcId?: string; network?: string }>(r.rawJson);
    const vpcRef = raw?.VpcId ?? raw?.vpcId ?? raw?.network;
    if (vpcRef) {
      const vpcNode = externalIdToNodeId.get(`${r.accountId}:${r.region}:${vpcRef}`);
      if (vpcNode) edges.push({ from: r.id, to: vpcNode, kind: "in-vpc" });
    }
  }

  // Parse instance rawJson for VPC / subnet / SG references.
  for (const i of insts) {
    const raw = parseJson<{
      VpcId?: string;
      SubnetId?: string;
      SecurityGroups?: { GroupId?: string }[];
      networkInterfaces?: { subnet?: string; network?: string }[];
    }>(i.rawJson);
    if (!raw) continue;
    const vpcRef = raw.VpcId ?? raw.networkInterfaces?.[0]?.network;
    const subnetRef = raw.SubnetId ?? raw.networkInterfaces?.[0]?.subnet;
    if (subnetRef) {
      const n = externalIdToNodeId.get(`${i.accountId}:${i.region}:${subnetRef.split("/").pop() ?? subnetRef}`);
      if (n) edges.push({ from: i.id, to: n, kind: "in-subnet" });
    }
    if (vpcRef) {
      const n = externalIdToNodeId.get(`${i.accountId}:${i.region}:${vpcRef.split("/").pop() ?? vpcRef}`);
      if (n) edges.push({ from: i.id, to: n, kind: "in-vpc" });
    }
    if (Array.isArray(raw.SecurityGroups)) {
      for (const sg of raw.SecurityGroups) {
        if (!sg.GroupId) continue;
        const n = externalIdToNodeId.get(`${i.accountId}:${i.region}:${sg.GroupId}`);
        if (n) edges.push({ from: i.id, to: n, kind: "in-group" });
      }
    }
  }

  return { nodes, edges, generatedAt: Date.now() };
}
