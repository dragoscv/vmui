"use client";

import { Button, Checkbox, Field, Input, Switch } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import type { QuietHoursConfig } from "@/lib/quiet-hours";
import { saveQuietHoursAction } from "@/server/actions/extras";
import { Save } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

const SEVERITIES = ["error", "warning", "success", "info"] as const;
type Severity = (typeof SEVERITIES)[number];

export function QuietHoursPanel({ initial }: { initial: QuietHoursConfig }) {
  const t = useTranslations("settings.automation.quietHours");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [cfg, setCfg] = useState<QuietHoursConfig>(initial);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const save = useAction(
    async (next: QuietHoursConfig) => {
      await saveQuietHoursAction(next);
      return ok();
    },
    { success: t("saved"), refresh: false, onSuccess: () => setSavedAt(new Date()) },
  );

  function toggleSev(s: Severity) {
    setCfg((c) => ({
      ...c,
      allowSeverities: c.allowSeverities.includes(s) ? c.allowSeverities.filter((x) => x !== s) : [...c.allowSeverities, s],
    }));
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run(cfg);
      }}
    >
      <Field inline label={t("enable")}>
        <Switch checked={cfg.enabled} onCheckedChange={(enabled) => setCfg({ ...cfg, enabled })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("start")}>
          <Input type="time" value={cfg.startHHMM} onChange={(e) => setCfg({ ...cfg, startHHMM: e.target.value })} className="tabular-nums" />
        </Field>
        <Field label={t("end")}>
          <Input type="time" value={cfg.endHHMM} onChange={(e) => setCfg({ ...cfg, endHHMM: e.target.value })} className="tabular-nums" />
        </Field>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs text-fg-muted">{t("allow")}</legend>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((s) => (
            <label key={s} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 text-sm">
              <Checkbox checked={cfg.allowSeverities.includes(s)} onCheckedChange={() => toggleSev(s)} />
              {t(`severity.${s}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-fg-muted">{savedAt ? t("savedAt", { time: format.dateTime(savedAt, { timeStyle: "short" }) }) : null}</span>
        <Button type="submit" size="sm" loading={save.pending}>
          <Save className="size-4" aria-hidden /> {tc("save")}
        </Button>
      </div>
    </form>
  );
}
