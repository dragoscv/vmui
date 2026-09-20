"use client";

import { Badge, Button, Field, Input, PageSection } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { isValidCron } from "@/lib/cron";
import { createScheduleAction, deleteScheduleAction, runScheduleNowAction, setScheduleEnabledAction } from "@/server/actions/schedules";
import { Clock, Pause, Play, PlayCircle, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SCHEDULE_ACTIONS, type ScheduleAction } from "./schedule-form";

const PRESETS: { key: "stopWeekdays" | "startWeekdays" | "rebootSunday"; cron: string; action: ScheduleAction }[] = [
  { key: "stopWeekdays", cron: "0 19 * * 1-5", action: "stop" },
  { key: "startWeekdays", cron: "0 8 * * 1-5", action: "start" },
  { key: "rebootSunday", cron: "0 3 * * 0", action: "reboot" },
];

const ACTION_VARIANT: Record<ScheduleAction, "warning" | "success" | "info"> = {
  stop: "warning",
  start: "success",
  reboot: "info",
  snapshot: "info",
};

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
  const t = useTranslations("ops.schedules");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const [cron, setCron] = useState("0 19 * * 1-5");
  const [action, setAction] = useState<ScheduleAction>("stop");
  const cronOk = isValidCron(cron);

  const create = useAction(
    async (): Promise<ActionResult> => {
      const r = await createScheduleAction({ instanceId, cron, action });
      return r.ok ? ok() : { ok: false, error: r.error };
    },
    { success: t("form.created") },
  );
  const toggle = useAction(async (id: string, enabled: boolean): Promise<ActionResult> => {
    const r = await setScheduleEnabledAction(id, enabled);
    return r.ok ? ok() : { ok: false, error: tc("error") };
  });
  const remove = useAction(
    async (id: string): Promise<ActionResult> => {
      const r = await deleteScheduleAction(id);
      return r.ok ? ok() : { ok: false, error: tc("error") };
    },
    { success: t("deleted") },
  );
  const runNow = useAction(
    async (id: string): Promise<ActionResult> => {
      const r = await runScheduleNowAction(id);
      if (!r.ok) return { ok: false, error: r.error };
      return r.status === "ok" ? ok() : { ok: false, error: r.message ?? t("runFailed") };
    },
    { success: t("ran") },
  );

  async function onRemove(s: ScheduleSummary) {
    const yes = await confirm({
      title: t("confirmDelete", { name: `${t(`form.actions.${s.action}`)} · ${s.cron}` }),
      description: t("confirmDeleteHint"),
      tone: "danger",
      confirmText: tc("delete"),
    });
    if (yes) await remove.run(s.id);
  }

  return (
    <PageSection title={t("card.title")} description={t("card.description")}>
      <div className="space-y-3">
        {schedules.length > 0 && (
          <ul className="grid gap-2">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant={ACTION_VARIANT[s.action]}>{t(`form.actions.${s.action}`)}</Badge>
                  <code className="font-mono">{s.cron}</code>
                  {!s.enabled && <Badge variant="muted">{t("paused")}</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 sm:size-8"
                    disabled={runNow.pending}
                    onClick={() => void runNow.run(s.id)}
                    aria-label={t("runNowAria")}
                    title={t("runNow")}
                  >
                    <Play className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 sm:size-8"
                    disabled={toggle.pending}
                    onClick={() => void toggle.run(s.id, !s.enabled)}
                    aria-label={s.enabled ? t("pause") : t("resume")}
                  >
                    {s.enabled ? <Pause className="size-3.5" aria-hidden /> : <PlayCircle className="size-3.5" aria-hidden />}
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8 sm:size-8" disabled={remove.pending} onClick={() => void onRemove(s)} aria-label={tc("delete")}>
                    <Trash2 className="size-3.5 text-danger" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (cronOk) void create.run();
          }}
        >
          <Field label={t("form.cron")}>
            <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="m h dom mon dow" className="font-mono" aria-invalid={!cronOk && cron.length > 0} />
          </Field>
          <Field label={t("form.action")}>
            <Select value={action} onValueChange={(v) => setAction(v as ScheduleAction)}>
              <SelectTrigger aria-label={t("form.action")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCHEDULE_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {t(`form.actions.${a}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button type="submit" size="md" loading={create.pending} disabled={!cronOk}>
            <Clock className="size-4" aria-hidden /> {tc("add")}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setCron(p.cron);
                setAction(p.action);
              }}
            >
              {t(`card.presets.${p.key}`)}
            </Button>
          ))}
        </div>
      </div>
    </PageSection>
  );
}
