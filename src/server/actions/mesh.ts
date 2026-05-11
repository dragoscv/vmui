"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { buildMesh, tailscaleUpCommand, tailscaleInstallCommand } from "@/lib/mesh";

const meshSchema = z.object({
  subnet: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24$/).default("10.66.0.0/24"),
  peers: z.array(
    z.object({
      name: z.string().min(1),
      ip: z.string(),
      publicIp: z.string().nullable(),
      listenPort: z.coerce.number().int().min(1).max(65535).default(51820),
    }),
  ).min(2),
});

export async function generateWgMeshAction(input: z.infer<typeof meshSchema>) {
  await requireRole("operator");
  const parsed = meshSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const baseOctets = parsed.data.subnet.split(".");
  const wgPeers = parsed.data.peers.map((p, i) => ({
    name: p.name,
    ip: p.ip,
    publicIp: p.publicIp,
    wgAddress: `${baseOctets[0]}.${baseOctets[1]}.${baseOctets[2]}.${i + 1}/32`,
    listenPort: p.listenPort,
  }));
  const result = buildMesh(wgPeers);
  return { ok: true as const, configs: result.configs };
}

const tsSchema = z.object({
  authKey: z.string().min(8),
  hostname: z.string().optional(),
  tags: z.array(z.string()).optional(),
  ssh: z.coerce.boolean().optional(),
  advertiseRoutes: z.array(z.string()).optional(),
});

export async function generateTailscaleCommandAction(input: z.infer<typeof tsSchema>) {
  await requireRole("operator");
  const parsed = tsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const install = tailscaleInstallCommand();
  const up = tailscaleUpCommand(parsed.data);
  return { ok: true as const, install, up, combined: `${install}\n${up}` };
}

const autoSchema = z.object({
  subnet: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.0\/24$/).default("10.66.0.0/24"),
  listenPort: z.coerce.number().int().min(1).max(65535).default(51820),
});

export async function autoBuildMeshFromFleetAction(input: z.infer<typeof autoSchema>) {
  await requireRole("operator");
  const parsed = autoSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };

  const running = db.select().from(instances).where(eq(instances.state, "running")).all();
  const reachable = running.filter((r) => r.publicIp);
  if (reachable.length < 2) return { ok: false as const, error: `need at least 2 reachable running VMs, found ${reachable.length}` };

  const baseOctets = parsed.data.subnet.split(".");
  const wgPeers = reachable.map((r, i) => ({
    name: (r.name ?? r.providerInstanceId).replace(/[^a-zA-Z0-9-]/g, "-"),
    ip: r.publicIp!,
    publicIp: r.publicIp,
    wgAddress: `${baseOctets[0]}.${baseOctets[1]}.${baseOctets[2]}.${i + 1}/32`,
    listenPort: parsed.data.listenPort,
  }));
  const result = buildMesh(wgPeers);
  return { ok: true as const, configs: result.configs, peerCount: reachable.length };
}
