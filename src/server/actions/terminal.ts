"use server";

import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, cloudAccounts, instances } from "@/lib/db/schema";
import { decryptJSON } from "@/lib/crypto";
import { requireRole } from "@/lib/auth";
import { issueSshSession } from "@/lib/ssh-bridge/server";
import type { ProbeKey } from "@/lib/probe";

const hostSchema = z.object({ instanceId: z.string().min(1) });
const execSchema = z.object({
  instanceId: z.string().min(1),
  containerId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.\-:/]+$/, "Bad container id"),
  shell: z.enum(["/bin/sh", "/bin/bash"]).default("/bin/sh"),
});

type IssueResult =
  | { ok: true; wsUrl: string; sessionId: string; label: string }
  | { ok: false; error: string };

async function buildHostProfile(instanceId: string) {
  const inst = await db.query.instances.findFirst({ where: eq(instances.id, instanceId) });
  if (!inst) throw new Error("Instance not found");
  if (!inst.publicIp && !inst.publicDns) throw new Error("Instance has no public IP/DNS");
  if (inst.platform === "windows") throw new Error("Terminal requires a Linux/macOS guest");
  const acc = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, inst.accountId) });
  if (!acc?.probeKeyEnc) throw new Error("No probe key for this account");
  const key = decryptJSON<ProbeKey>(acc.probeKeyEnc);
  const host = inst.publicIp ?? inst.publicDns!;
  const user = key.defaultUser ?? (inst.provider === "aws" ? "ec2-user" : "ubuntu");
  return {
    host,
    user,
    key,
    label: `${inst.name ?? inst.providerInstanceId} (${host})`,
  };
}

export async function openHostTerminalAction(input: z.infer<typeof hostSchema>): Promise<IssueResult> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = hostSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input" };
  try {
    const p = await buildHostProfile(parsed.data.instanceId);
    const { sessionId, wsUrl } = issueSshSession({
      host: p.host,
      port: 22,
      username: p.user,
      privateKey: p.key.privateKey,
      passphrase: p.key.passphrase,
      label: p.label,
    });
    await db.insert(auditLog).values({
      action: "terminal.open.host",
      target: parsed.data.instanceId,
      status: "ok",
    });
    return { ok: true, wsUrl, sessionId, label: p.label };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function openContainerTerminalAction(
  input: z.infer<typeof execSchema>,
): Promise<IssueResult> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  const parsed = execSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Bad input" };
  try {
    const p = await buildHostProfile(parsed.data.instanceId);
    const cmd = `docker exec -it ${parsed.data.containerId} ${parsed.data.shell}`;
    const fallback = `(docker exec -it ${parsed.data.containerId} ${parsed.data.shell} || podman exec -it ${parsed.data.containerId} ${parsed.data.shell} || sudo nerdctl exec -it ${parsed.data.containerId} ${parsed.data.shell})`;
    const { sessionId, wsUrl } = issueSshSession({
      host: p.host,
      port: 22,
      username: p.user,
      privateKey: p.key.privateKey,
      passphrase: p.key.passphrase,
      label: `${parsed.data.containerId} @ ${p.host}`,
      command: fallback,
    });
    await db.insert(auditLog).values({
      action: "terminal.open.container",
      target: `${parsed.data.instanceId}:${parsed.data.containerId}`,
      status: "ok",
      message: cmd,
    });
    return { ok: true, wsUrl, sessionId, label: `${parsed.data.containerId} @ ${p.host}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed" };
  }
}
