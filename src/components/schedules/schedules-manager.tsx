"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2, Pause, Play } from "lucide-react";
import {
  createScheduleAction,
  setScheduleEnabledAction,
  deleteScheduleAction,
} from "@/server/actions/schedules";
import { isValidCron, nextRun, nextRuns } from "@/lib/cron";

const PRESETS: { label: string; cron: string }[] = [
  { label: "Every weekday at 19:00", cron: "0 19 * * 1-5" },
  { label: "Every day at 02:00", cron: "0 2 * * *" },
  { label: "Mondays at 08:00", cron: "0 8 * * 1" },
  { label: "Every 30 minutes", cron: "*/30 * * * *" },
];

interface ScheduleSummary {
  id: string;
  cron: string;
  action: "start" | "stop" | "reboot" | "snapshot";
  enabled: boolean;
  label: string | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  instanceName: string;
  accountName: string;
}

export function SchedulesManager({
  initialSchedules,
  instances,
}: {
  initialSchedules: ScheduleSummary[];
  instances: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [cron, setCron] = useState("0 19 * * 1-5");
  const [action, setAction] = useState<"start" | "stop" | "reboot" | "snapshot">("stop");
  const [label, setLabel] = useState("");

  const cronOk = isValidCron(cron);

  function submit() {
    if (!instanceId) {
      toast.error("Pick an instance.");
      return;
    }
    if (!cronOk) {
      toast.error("Invalid cron expression.");
      return;
    }
    startTransition(async () => {
      const res = await createScheduleAction({
        instanceId,
        cron,
        action,
        label: label.trim() || undefined,
      });
      if (!res.ok) toast.error(res.error);
      else toast.success("Schedule created.");
    });
  }

  return (
    <div className="space-y-6">
      <Card className="surface">
        <CardHeader>
          <CardTitle className="text-base">New schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label>Instance</Label>
            <select
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
            >
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label>Action</Label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as "start" | "stop" | "reboot" | "snapshot")}
              className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
            >
              <option value="stop">Stop</option>
              <option value="start">Start</option>
              <option value="reboot">Reboot</option>
              <option value="snapshot">Snapshot</option>
            </select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Cron expression</Label>
            <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="m h dom mon dow" />
            <div className="flex flex-wrap gap-2 pt-1">
              {PRESETS.map((p) => (
                <button
                  key={p.cron}
                  type="button"
                  onClick={() => setCron(p.cron)}
                  className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-muted hover:border-[var(--color-primary)]/40"
                >
                  {p.label}
                </button>
              ))}
            </div>
            {!cronOk && cron.length > 0 && (
              <p className="text-[11px] text-[var(--color-danger)]">Invalid cron expression.</p>
            )}
            {cronOk && (() => {
              const upcoming = nextRuns(cron, 5);
              if (upcoming.length === 0) {
                return (
                  <p className="text-[11px] text-muted">
                    Next run: never (no match in the next year)
                  </p>
                );
              }
              return (
                <div className="text-[11px] text-muted">
                  <span>Next {upcoming.length} run{upcoming.length === 1 ? "" : "s"}:</span>
                  <ul className="mt-1 ml-3 list-disc space-y-0.5">
                    {upcoming.map((d) => (
                      <li key={d.getTime()} className="font-mono">{d.toLocaleString()}</li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label>Label (optional)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Stop dev workstation overnight" />
          </div>

          <div className="md:col-span-2">
            <Button disabled={pending || !cronOk || !instanceId} onClick={submit}>
              {pending ? "Saving…" : "Create schedule"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="surface">
        <CardHeader>
          <CardTitle className="text-base">Active schedules</CardTitle>
        </CardHeader>
        <CardContent>
          {initialSchedules.length === 0 ? (
            <p className="text-sm text-muted">No schedules yet. Create one above to auto-stop overnight, restart in the morning, or reboot weekly.</p>
          ) : (
            <div className="grid gap-2">
              {initialSchedules.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant={s.action === "stop" ? "warning" : s.action === "start" ? "success" : "info"}>
                        {s.action.toUpperCase()}
                      </Badge>
                      <span className="font-mono text-xs">{s.cron}</span>
                      {(() => {
                        const nr = nextRun(s.cron);
                        return nr ? (
                          <span className="text-[10px] text-muted">next → {nr.toLocaleString()}</span>
                        ) : null;
                      })()}
                      {!s.enabled && <Badge variant="muted">pa</Badge>}
                    </div>
                    <div className="text-xs text-muted">
                      {s.instanceName} · {s.accountName}
                      {s.label ? ` · ${s.label}` : ""}
                    </div>
                    {s.lastRunAt && (
                      <div className="text-[11px] text-muted">
                        last run {new Date(s.lastRunAt).toLocaleString()} · {s.lastRunStatus ?? "?"}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        startTransition(async () => {
                          await setScheduleEnabledAction(s.id, !s.enabled);
                          toast.success(s.enabled ? "Paused." : "Resumed.");
                        })
                      }
                    >
                      {s.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        startTransition(async () => {
                          await deleteScheduleAction(s.id);
                          toast.success("Deleted.");
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--color-danger)]" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
