"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Pause, Play, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  createScheduleAction,
  setScheduleEnabledAction,
  deleteScheduleAction,
} from "@/server/actions/schedules";
import { isValidCron } from "@/lib/cron";

const PRESETS = [
  { label: "Stop @ 19:00 weekdays", cron: "0 19 * * 1-5", action: "stop" as const },
  { label: "Start @ 08:00 weekdays", cron: "0 8 * * 1-5", action: "start" as const },
  { label: "Reboot Sunday 03:00", cron: "0 3 * * 0", action: "reboot" as const },
];

interface ScheduleSummary {
  id: string;
  cron: string;
  action: "start" | "stop" | "reboot" | "snapshot";
  enabled: boolean;
  label: string | null;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
}

export function InstanceSchedulesCard({
  instanceId,
  schedules,
}: {
  instanceId: string;
  schedules: ScheduleSummary[];
}) {
  const [pending, startTransition] = useTransition();
  const [cron, setCron] = useState("0 19 * * 1-5");
  const [action, setAction] = useState<"start" | "stop" | "reboot" | "snapshot">("stop");
  const cronOk = isValidCron(cron);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4" /> Schedules
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {schedules.length > 0 && (
          <div className="grid gap-2">
            {schedules.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2">
                  <Badge variant={s.action === "stop" ? "warning" : s.action === "start" ? "success" : "info"}>
                    {s.action.toUpperCase()}
                  </Badge>
                  <span className="font-mono">{s.cron}</span>
                  {!s.enabled && <Badge variant="muted">paused</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      startTransition(async () => {
                        await setScheduleEnabledAction(s.id, !s.enabled);
                      })
                    }
                  >
                    {s.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startTransition(async () => void deleteScheduleAction(s.id))}
                  >
                    <Trash2 className="h-3 w-3 text-[var(--color-danger)]" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <div>
            <Label className="text-[11px]">Cron</Label>
            <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="m h dom mon dow" />
          </div>
          <div>
            <Label className="text-[11px]">Action</Label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as typeof action)}
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
            >
              <option value="stop">Stop</option>
              <option value="start">Start</option>
              <option value="reboot">Reboot</option>
              <option value="snapshot">Snapshot</option>
            </select>
          </div>
          <div className="self-end">
            <Button
              size="sm"
              disabled={pending || !cronOk}
              onClick={() =>
                startTransition(async () => {
                  const r = await createScheduleAction({ instanceId, cron, action });
                  if (!r.ok) toast.error(r.error);
                  else toast.success("Schedule created.");
                })
              }
            >
              Add
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.cron + p.action}
              type="button"
              onClick={() => {
                setCron(p.cron);
                setAction(p.action);
              }}
              className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-muted hover:border-[var(--color-primary)]/40"
            >
              {p.label}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
