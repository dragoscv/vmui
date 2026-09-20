"use client";

import { AuthField, PasswordInput } from "@/components/auth/auth-field";
import { Button } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import { changeMyPasswordAction } from "@/server/actions/auth";
import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toResult } from "./adapt";

export function ChangePasswordCard() {
  const t = useTranslations("settings.security.password");
  const ids = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const short = next.length > 0 && next.length < 8;
  const same = next.length > 0 && current.length > 0 && next === current;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !same;

  const change = useAction(
    async (currentPassword: string, newPassword: string) => toResult(await changeMyPasswordAction({ currentPassword, newPassword })),
    {
      success: t("changed"),
      onSuccess: () => {
        setCurrent("");
        setNext("");
        setConfirm("");
      },
    },
  );

  return (
    <form
      className="grid gap-3 sm:grid-cols-3 sm:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) void change.run(current, next);
      }}
    >
      <AuthField id={`${ids}-current`} label={t("current")}>
        {(a11y) => <PasswordInput {...a11y} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />}
      </AuthField>
      <AuthField id={`${ids}-new`} label={t("new")} error={short ? t("errors.short") : same ? t("errors.same") : null}>
        {(a11y) => (
          <PasswordInput {...a11y} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} required />
        )}
      </AuthField>
      <AuthField id={`${ids}-confirm`} label={t("confirm")} error={mismatch ? t("errors.mismatch") : null}>
        {(a11y) => (
          <PasswordInput {...a11y} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} required />
        )}
      </AuthField>
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
        <p className="text-xs text-fg-muted">{t("changedHint")}</p>
        <Button type="submit" loading={change.pending} disabled={!canSubmit}>
          <KeyRound className="size-4" aria-hidden /> {t("submit")}
        </Button>
      </div>
    </form>
  );
}
