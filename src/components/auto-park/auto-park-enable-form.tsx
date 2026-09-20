"use client";

import { Button, Field, Input } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { setIdleParkPolicyAction } from "@/server/actions/automation";
import { Pause } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export interface AutoParkTarget {
  accountId: string;
  providerInstanceId: string;
  name: string;
  region: string;
}

interface Draft {
  target: string;
  cpuPct: number;
  netKbps: number;
  windowMin: number;
}

const EMPTY: Draft = { target: "", cpuPct: 5, netKbps: 50, windowMin: 30 };

function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function AutoParkEnableForm({ targets }: { targets: AutoParkTarget[] }) {
  const t = useTranslations("ops.autoPark");
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const enable = useAction(
    async (d: Draft) => {
      const [accountId, providerInstanceId] = d.target.split("|");
      if (!accountId || !providerInstanceId) return { ok: false as const, error: t("pickVm") };
      await setIdleParkPolicyAction({
        accountId,
        providerInstanceId,
        cpuPct: d.cpuPct,
        netKbps: d.netKbps,
        windowMin: d.windowMin,
        enabled: true,
      });
      return ok();
    },
    { success: t("enabled"), onSuccess: () => setDraft(EMPTY) },
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.target) void enable.run(draft);
      }}
    >
      <Field label={t("fields.vm")} hint={t("fields.vmHint")}>
        <Select value={draft.target} onValueChange={(v) => setDraft({ ...draft, target: v })}>
          <SelectTrigger aria-label={t("fields.vm")}>
            <SelectValue placeholder={t("pickVm")} />
          </SelectTrigger>
          <SelectContent>
            {targets.map((i) => (
              <SelectItem key={`${i.accountId}|${i.providerInstanceId}`} value={`${i.accountId}|${i.providerInstanceId}`}>
                {i.name} · {i.region}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("fields.cpuPct")} hint={t("fields.cpuPctHint")}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            value={draft.cpuPct}
            onChange={(e) => setDraft({ ...draft, cpuPct: num(e.target.value, 5) })}
            required
          />
        </Field>
        <Field label={t("fields.netKbps")} hint={t("fields.netKbpsHint")}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            value={draft.netKbps}
            onChange={(e) => setDraft({ ...draft, netKbps: num(e.target.value, 50) })}
            required
          />
        </Field>
        <Field label={t("fields.windowMin")} hint={t("fields.windowMinHint")}>
          <Input
            type="number"
            inputMode="numeric"
            min={5}
            max={720}
            value={draft.windowMin}
            onChange={(e) => setDraft({ ...draft, windowMin: num(e.target.value, 30) })}
            required
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={enable.pending} disabled={!draft.target || targets.length === 0}>
          <Pause className="size-4" aria-hidden /> {t("enable")}
        </Button>
      </div>
    </form>
  );
}
