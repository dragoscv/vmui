"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { auditLog, sshHostKeys } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { forgetSshHostKey } from "@/lib/ssh-bridge/server";
import { requireRole } from "@/lib/auth";

export interface KnownHostRow {
  id: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprintSha256: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * List every pinned SSH host fingerprint, newest-seen first. Reads from the
 * persisted table rather than the in-memory cache so a fresh dev restart
 * still shows pins after layout boot.
 */
export async function listKnownHostsAction(): Promise<KnownHostRow[]> {
  const rows = await db.select().from(sshHostKeys).orderBy(desc(sshHostKeys.lastSeenAt));
  return rows;
}

const removeSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
});

export async function forgetKnownHostAction(input: {
  host: string;
  port: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try { await requireRole("operator"); } catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Not authorized" }; }
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  await forgetSshHostKey(parsed.data.host, parsed.data.port);
  await db.insert(auditLog).values({
    action: "ssh.host-key.forget",
    target: `${parsed.data.host}:${parsed.data.port}`,
    status: "ok",
  });
  revalidatePath("/settings");
  return { ok: true };
}
