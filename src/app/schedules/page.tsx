import "server-only";
import { Clock } from "lucide-react";
import { listSchedules } from "@/server/queries/schedules";
import { db } from "@/lib/db";
import { instances, cloudAccounts } from "@/lib/db/schema";
import { SchedulesManager } from "@/components/schedules/schedules-manager";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const [rows, instanceList, accountList] = await Promise.all([
    listSchedules(),
    db.select().from(instances),
    db.select().from(cloudAccounts),
  ]);
  const instanceMap = new Map(instanceList.map((i) => [i.id, i] as const));
  const accountMap = new Map(accountList.map((a) => [a.id, a] as const));

  const summaries = rows.map((s) => {
    const inst = instanceMap.get(s.instanceId);
    const acc = accountMap.get(s.accountId);
    return {
      id: s.id,
      cron: s.cron,
      action: s.action,
      enabled: s.enabled,
      label: s.label,
      lastRunAt: s.lastRunAt,
      lastRunStatus: s.lastRunStatus,
      instanceName: inst?.displayName ?? inst?.name ?? inst?.providerInstanceId ?? "(unknown)",
      accountName: acc?.name ?? "(unknown)",
    };
  });

  const pickList = instanceList
    .map((i) => {
      const acc = accountMap.get(i.accountId);
      return {
        id: i.id,
        label: `${i.displayName ?? i.name ?? i.providerInstanceId} · ${acc?.name ?? i.provider}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Clock className="h-6 w-6 text-[var(--color-primary)]" />
          Schedules
        </h1>
        <p className="text-sm text-muted">
          Cron-driven start / stop / reboot. Use to auto-shutdown dev VMs overnight, weekly reboots, or
          scheduled wake-ups.
        </p>
      </div>

      <SchedulesManager initialSchedules={summaries} instances={pickList} />
    </div>
  );
}
