"use server";
import "server-only";
import { db } from "@/lib/db";
import { auditLog, instances } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { instanceAction } from "@/server/actions/instances";

const REPLAYABLE: Record<string, "start" | "stop" | "reboot"> = {
  "instance.start": "start",
  "instance.stop": "stop",
  "instance.reboot": "reboot",
};

export async function replayAuditAction(input: { auditId: number }) {
  await requireRole("operator");
  const [row] = await db.select().from(auditLog).where(eq(auditLog.id, input.auditId)).limit(1);
  if (!row) return { ok: false as const, error: "Audit row not found" };
  const op = REPLAYABLE[row.action];
  if (!op) return { ok: false as const, error: `Action '${row.action}' is not replayable` };
  const target = row.target;
  const accountId = row.accountId;
  if (!target || !accountId) return { ok: false as const, error: "Missing target/account" };

  const [inst] = await db.select().from(instances)
    .where(and(eq(instances.accountId, accountId), eq(instances.providerInstanceId, target)))
    .limit(1);
  if (!inst) return { ok: false as const, error: "Instance no longer exists" };

  return await instanceAction(op, {
    accountId,
    region: inst.region,
    providerInstanceId: inst.providerInstanceId,
  });
}
