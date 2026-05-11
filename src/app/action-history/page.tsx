import "server-only";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { ActionHistoryClient } from "@/components/action-history.client";

export const dynamic = "force-dynamic";

export default async function ActionHistoryPage() {
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(500);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Action history</h1>
        <p className="text-sm text-zinc-400">Last 500 audit-log entries. Replay supported for start / stop / reboot.</p>
      </header>
      <ActionHistoryClient rows={rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        action: r.action,
        target: r.target,
        status: r.status,
        message: r.message,
        accountId: r.accountId,
      }))} />
    </div>
  );
}
