import { StatusBoard } from "@/components/monitoring/status-board";
import { PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { auditLog, instances, snapshotHistory } from "@/lib/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { Activity } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { createHmac } from "node:crypto";

export const dynamic = "force-dynamic";
export const revalidate = 30;

const UPTIME_DAYS = 30;

interface StatusPayload {
  generatedAt: string;
  totalInstances: number;
  byState: Record<string, number>;
  byProvider: Record<string, number>;
  fleetHourlyUsd: number;
  recentErrors24h: number;
}

function signPayload(p: StatusPayload): string {
  const key = process.env.VMUI_MASTER_KEY ?? "";
  return createHmac("sha256", key).update(JSON.stringify(p)).digest("hex").slice(0, 16);
}

export default async function StatusPage() {
  const t = await getTranslations("observe.status");
  const all = await db.select().from(instances).limit(1000);
  const byState: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  for (const i of all) {
    byState[i.state] = (byState[i.state] ?? 0) + 1;
    byProvider[i.provider] = (byProvider[i.provider] ?? 0) + 1;
  }
  const snap = db.select().from(snapshotHistory).orderBy(desc(snapshotHistory.capturedAt)).limit(1).get();
  const since30d = new Date(Date.now() - UPTIME_DAYS * 86_400_000);
  const audits = db
    .select({ status: auditLog.status, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(gte(auditLog.createdAt, since30d))
    .all();
  const errs24h = db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.status, "error"), gte(auditLog.createdAt, new Date(Date.now() - 86_400_000))))
    .all().length;

  const payload: StatusPayload = {
    generatedAt: new Date().toISOString(),
    totalInstances: all.length,
    byState,
    byProvider,
    fleetHourlyUsd: snap?.hourlyUsd ?? 0,
    recentErrors24h: errs24h,
  };

  const perDay = new Map<string, { ok: number; total: number }>();
  for (const a of audits) {
    const day = a.createdAt.toISOString().slice(0, 10);
    const b = perDay.get(day) ?? { ok: 0, total: 0 };
    b.total++;
    if (a.status === "ok") b.ok++;
    perDay.set(day, b);
  }
  const uptime = Array.from({ length: UPTIME_DAYS }, (_, i) => {
    const day = new Date(Date.now() - (UPTIME_DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const b = perDay.get(day);
    return { day, okRatio: b && b.total > 0 ? b.ok / b.total : null };
  });

  const running = byState["running"] ?? 0;
  const healthy = running > 0 && (byState["stopped"] ?? 0) < running;

  return (
    <PageShell width="narrow">
      <PageHeader title={t("title")} description={t("description")} icon={<Activity />} />
      <StatusBoard
        healthy={healthy}
        generatedAt={Date.parse(payload.generatedAt)}
        totalInstances={payload.totalInstances}
        running={running}
        stopped={byState["stopped"] ?? 0}
        fleetHourlyUsd={payload.fleetHourlyUsd}
        recentErrors24h={errs24h}
        byProvider={Object.entries(byProvider).map(([name, value]) => ({ name, value }))}
        uptime={uptime}
        signature={signPayload(payload)}
      />
    </PageShell>
  );
}
