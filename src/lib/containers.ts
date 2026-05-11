import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { sshExec } from "@/lib/ssh-exec";
import type { ProbeKey } from "@/lib/probe";

export type ContainerRuntime = "docker" | "podman" | "nerdctl";

export interface ContainerRow {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  createdAt: string;
  ports: string;
  runtime: ContainerRuntime;
}

export interface ContainerListResult {
  runtime: ContainerRuntime | null;
  rows: ContainerRow[];
  warning?: string;
}

interface SshTarget {
  host: string;
  port: number;
  user: string;
  key: ProbeKey;
}

async function loadSshTarget(instanceId: string): Promise<SshTarget> {
  const inst = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) });
  if (!inst) throw new Error("Instance not found");
  if (!inst.publicIp && !inst.publicDns) throw new Error("Instance has no public IP/DNS");
  if (inst.platform === "windows") throw new Error("Containers view requires Linux/macOS guests");
  const acc = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, inst.accountId) });
  if (!acc?.probeKeyEnc) throw new Error("No probe key for this account");
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  return {
    host: inst.publicIp ?? inst.publicDns!,
    port: 22,
    user: key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu"),
    key,
  };
}

const PROBE_SCRIPT = `if command -v docker >/dev/null 2>&1; then echo docker; elif command -v podman >/dev/null 2>&1; then echo podman; elif command -v nerdctl >/dev/null 2>&1; then echo nerdctl; else echo none; fi`;

async function detectRuntime(t: SshTarget): Promise<ContainerRuntime | null> {
  const res = await sshExec({ ...t, command: PROBE_SCRIPT, timeoutMs: 8000 });
  const v = res.stdout.trim();
  if (v === "docker" || v === "podman" || v === "nerdctl") return v;
  return null;
}

function listCommand(rt: ContainerRuntime): string {
  // All three runtimes support `ps -a --format json`; podman emits a single
  // JSON array, docker+nerdctl emit one JSON object per line.
  if (rt === "docker") return `docker ps -a --format '{{json .}}' 2>&1`;
  if (rt === "nerdctl") return `sudo -n nerdctl ps -a --format '{{json .}}' 2>&1 || nerdctl ps -a --format '{{json .}}' 2>&1`;
  return `podman ps -a --format json 2>&1`;
}

interface RawCli {
  ID?: string;
  Id?: string;
  Names?: string | string[];
  Image?: string;
  Status?: string;
  State?: string;
  Ports?: string;
  CreatedAt?: string;
  Created?: number;
}

function parseRows(rt: ContainerRuntime, raw: string): ContainerRow[] {
  const out: ContainerRow[] = [];
  if (rt === "podman") {
    try {
      const arr = JSON.parse(raw) as RawCli[];
      for (const r of arr) out.push(normalize(rt, r));
    } catch {
      return [];
    }
    return out;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed) as RawCli;
      out.push(normalize(rt, obj));
    } catch {
      // skip mal-formed line
    }
  }
  return out;
}

function normalize(rt: ContainerRuntime, r: RawCli): ContainerRow {
  const name = Array.isArray(r.Names) ? r.Names[0] ?? "" : (r.Names ?? "");
  return {
    id: (r.ID ?? r.Id ?? "").slice(0, 12),
    name: name.replace(/^\//, ""),
    image: r.Image ?? "",
    status: r.Status ?? "",
    state: (r.State ?? "").toString().toLowerCase(),
    createdAt: r.CreatedAt ?? (r.Created ? new Date(r.Created * 1000).toISOString() : ""),
    ports: r.Ports ?? "",
    runtime: rt,
  };
}

export async function listContainersOnInstance(instanceId: string): Promise<ContainerListResult> {
  const t = await loadSshTarget(instanceId);
  const rt = await detectRuntime(t);
  if (!rt) return { runtime: null, rows: [], warning: "No container runtime detected (docker/podman/nerdctl)" };
  const res = await sshExec({ ...t, command: listCommand(rt), timeoutMs: 12_000 });
  const rows = parseRows(rt, res.stdout);
  return { runtime: rt, rows };
}

export async function containerAction(
  instanceId: string,
  containerId: string,
  action: "start" | "stop" | "restart" | "remove" | "pull",
): Promise<{ ok: boolean; output: string }> {
  const t = await loadSshTarget(instanceId);
  const rt = await detectRuntime(t);
  if (!rt) return { ok: false, output: "No container runtime detected" };
  const safeId = containerId.replace(/[^a-zA-Z0-9_.\-:/]/g, "");
  let cmd: string;
  switch (action) {
    case "remove":
      cmd = `${rt} rm -f ${safeId}`;
      break;
    case "pull":
      cmd = `${rt} pull ${safeId}`;
      break;
    default:
      cmd = `${rt} ${action} ${safeId}`;
  }
  if (rt === "nerdctl") cmd = `sudo -n ${cmd} 2>&1 || ${cmd} 2>&1`;
  const res = await sshExec({ ...t, command: cmd, timeoutMs: 60_000 });
  return { ok: res.code === 0, output: res.stdout + res.stderr };
}

export async function inspectContainer(
  instanceId: string,
  containerId: string,
): Promise<{ ok: boolean; data: unknown; output: string }> {
  const t = await loadSshTarget(instanceId);
  const rt = await detectRuntime(t);
  if (!rt) return { ok: false, data: null, output: "No container runtime detected" };
  const safeId = containerId.replace(/[^a-zA-Z0-9_.\-:/]/g, "");
  const cmd = rt === "nerdctl" ? `sudo -n nerdctl inspect ${safeId} || nerdctl inspect ${safeId}` : `${rt} inspect ${safeId}`;
  const res = await sshExec({ ...t, command: cmd, timeoutMs: 15_000 });
  if (res.code !== 0) return { ok: false, data: null, output: res.stdout + res.stderr };
  try {
    return { ok: true, data: JSON.parse(res.stdout), output: "" };
  } catch {
    return { ok: false, data: null, output: "Could not parse inspect JSON" };
  }
}

export interface ContainerStats {
  id: string;
  name: string;
  cpuPct: number;
  memUsage: string;
  memPct: number;
  netIo: string;
  blockIo: string;
}

export async function containerStats(instanceId: string): Promise<{ rows: ContainerStats[]; runtime: ContainerRuntime | null }> {
  const t = await loadSshTarget(instanceId);
  const rt = await detectRuntime(t);
  if (!rt) return { rows: [], runtime: null };
  const cmd =
    rt === "nerdctl"
      ? `sudo -n nerdctl stats --no-stream --format '{{json .}}' 2>&1 || nerdctl stats --no-stream --format '{{json .}}' 2>&1`
      : `${rt} stats --no-stream --format '{{json .}}' 2>&1`;
  const res = await sshExec({ ...t, command: cmd, timeoutMs: 15_000 });
  const rows: ContainerStats[] = [];
  for (const line of res.stdout.split("\n")) {
    const tr = line.trim();
    if (!tr || !tr.startsWith("{")) continue;
    try {
      const r = JSON.parse(tr) as {
        ID?: string;
        Name?: string;
        CPUPerc?: string;
        MemUsage?: string;
        MemPerc?: string;
        NetIO?: string;
        BlockIO?: string;
      };
      const cpuPct = parseFloat((r.CPUPerc ?? "0").replace("%", "")) || 0;
      const memPct = parseFloat((r.MemPerc ?? "0").replace("%", "")) || 0;
      rows.push({
        id: (r.ID ?? "").slice(0, 12),
        name: r.Name ?? "",
        cpuPct,
        memUsage: r.MemUsage ?? "",
        memPct,
        netIo: r.NetIO ?? "",
        blockIo: r.BlockIO ?? "",
      });
    } catch {
      // skip
    }
  }
  return { rows, runtime: rt };
}
