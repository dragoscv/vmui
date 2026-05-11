"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { probeSamples, auditLog, instances } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { and, gte, lte, asc, eq } from "drizzle-orm";

const schema = z.object({
  instanceId: z.string().min(1),
  fromMs: z.number().int(),
  toMs: z.number().int(),
});

export async function loadTimelineAction(input: z.infer<typeof schema>) {
  await requireRole("viewer");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "invalid" };
  const v = parsed.data;
  const inst = db.select().from(instances).where(eq(instances.id, v.instanceId)).get();
  if (!inst) return { ok: false as const, error: "instance not found" };

  const from = new Date(v.fromMs);
  const to = new Date(v.toMs);

  const samples = db
    .select()
    .from(probeSamples)
    .where(and(eq(probeSamples.instanceId, v.instanceId), gte(probeSamples.collectedAt, from), lte(probeSamples.collectedAt, to)))
    .orderBy(asc(probeSamples.collectedAt))
    .all();

  const audits = db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.target, inst.providerInstanceId), gte(auditLog.createdAt, from), lte(auditLog.createdAt, to)))
    .orderBy(asc(auditLog.createdAt))
    .all();

  const snaps: { t: number; id: string; label: string | null }[] = [];

  return {
    ok: true as const,
    instance: { id: inst.id, name: inst.name, provider: inst.provider, region: inst.region },
    samples: samples.map((s) => {
      let m: { cpu?: number; mem?: number; net_in?: number; net_out?: number; load1?: number } = {};
      try { m = JSON.parse(s.metricsJson); } catch { /* noop */ }
      return {
        t: s.collectedAt.getTime(),
        cpu: m.cpu ?? null,
        mem: m.mem ?? null,
        netIn: m.net_in ?? null,
        netOut: m.net_out ?? null,
        load1: m.load1 ?? null,
      };
    }),
    audits: audits.map((a) => ({ t: a.createdAt.getTime(), action: a.action, status: a.status, message: a.message })),
    snapshots: snaps,
  };
}

export async function listTimelineInstancesAction() {
  await requireRole("viewer");
  return db.select({ id: instances.id, name: instances.name, provider: instances.provider, region: instances.region }).from(instances).all();
}
