"use client";

import { Button, Field, Input } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { isValidCron, nextRuns } from "@/lib/cron";
import { createScheduleAction } from "@/server/actions/schedules";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

export type ScheduleAction = "start" | "stop" | "reboot" | "snapshot";
export const SCHEDULE_ACTIONS: ScheduleAction[] = ["stop", "start", "reboot", "snapshot"];

const PRESETS: { key: "weekdays19" | "daily02" | "monday08" | "every30m"; cron: string }[] = [
  { key: "weekdays19", cron: "0 19 * * 1-5" },
  { key: "daily02", cron: "0 2 * * *" },
  { key: "monday08", cron: "0 8 * * 1" },
  { key: "every30m", cron: "*/30 * * * *" },
];

export function ScheduleForm({
  instances,
  onDone,
}: {
  instances: { id: string; label: string }[];
  onDone?: () => void;
}) {
  const t = useTranslations("ops.schedules.form");
  const format = useFormatter();
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? "");
  const [cron, setCron] = useState("0 19 * * 1-5");
  const [action, setAction] = useState<ScheduleAction>("stop");
  const [label, setLabel] = useState("");
  const cronOk = isValidCron(cron);

  const create = useAction(
    async (): Promise<ActionResult> => {
      if (!instanceId) return { ok: false, error: t("pickInstance") };
      if (!cronOk) return { ok: false, error: t("invalidCron") };
      const res = await createScheduleAction({ instanceId, cron, action, label: label.trim() || undefined });
      return res.ok ? ok() : { ok: false, error: res.error };
    },
    { success: t("created"), onSuccess: onDone },
  );

  const upcoming = cronOk ? nextRuns(cron, 5) : [];

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void create.run();
      }}
    >
      <Field label={t("instance")}>
        <Select value={instanceId} onValueChange={setInstanceId}>
          <SelectTrigger aria-label={t("instance")}>
            <SelectValue placeholder={t("pickInstance")} />
          </SelectTrigger>
          <SelectContent>
            {instances.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("action")}>
        <Select value={action} onValueChange={(v) => setAction(v as ScheduleAction)}>
          <SelectTrigger aria-label={t("action")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEDULE_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {t(`actions.${a}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label={t("cron")} className="sm:col-span-2" hint={!cronOk && cron.length > 0 ? <span className="text-danger">{t("invalidCron")}</span> : undefined}>
        <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="m h dom mon dow" className="font-mono" aria-invalid={!cronOk && cron.length > 0} />
      </Field>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        {PRESETS.map((p) => (
          <Button key={p.cron} type="button" size="sm" variant={cron === p.cron ? "secondary" : "outline"} onClick={() => setCron(p.cron)}>
            {t(`presets.${p.key}`)}
          </Button>
        ))}
      </div>
      {cronOk && (
        <div className="text-xs text-fg-muted sm:col-span-2">
          {upcoming.length === 0 ? (
            <p>{t("nextNever")}</p>
          ) : (
            <>
              <p>{t("nextRuns", { count: upcoming.length })}</p>
              <ul className="mt-1 ml-3 list-disc space-y-0.5">
                {upcoming.map((d) => (
                  <li key={d.getTime()} className="font-mono">
                    {format.dateTime(d, { dateStyle: "medium", timeStyle: "short" })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <Field label={t("label")} className="sm:col-span-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("labelPlaceholder")} />
      </Field>

      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" loading={create.pending} disabled={!cronOk || !instanceId}>
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
