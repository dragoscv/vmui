"use server";

import { z } from "zod";
import { listAuditLogFiltered, type AuditLogPage } from "@/server/queries";

const inputSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(["ok", "error"]).optional(),
  accountId: z.string().min(1).max(64).optional(),
  sinceMs: z.number().int().positive().max(365 * 24 * 60 * 60 * 1000).optional(),
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export type LoadAuditPageInput = z.infer<typeof inputSchema>;

export async function loadAuditPageAction(
  input: LoadAuditPageInput,
): Promise<{ ok: true; page: AuditLogPage } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const { sinceMs, ...rest } = parsed.data;
  const page = await listAuditLogFiltered({
    ...rest,
    since: sinceMs ? new Date(Date.now() - sinceMs) : undefined,
  });
  return { ok: true, page };
}
