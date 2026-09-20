"use client";

import { AuthField, PasswordInput } from "@/components/auth/auth-field";
import { Alert, Button } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { adminResetPasswordAction } from "@/server/actions/auth";
import { Check, Copy, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toError } from "./adapt";

interface Target {
  id: string;
  email: string;
}

export function ResetPasswordDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const t = useTranslations("settings.users.resetPassword");
  const tc = useTranslations("common");
  const ids = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const short = password.length > 0 && password.length < 8;
  const canSubmit = password.length >= 8 && password === confirm;

  const reset = useAction(
    async (userId: string, typed?: string): Promise<ActionResult<string | null>> => {
      const r = await adminResetPasswordAction(typed ? { userId, password: typed } : { userId });
      return r.ok ? ok(r.password ?? null) : toError(r);
    },
    {
      success: t("done"),
      onSuccess: (generated) => {
        setPassword("");
        setConfirm("");
        if (generated) setIssued(generated);
        else close();
      },
    },
  );

  function close() {
    setPassword("");
    setConfirm("");
    setIssued(null);
    setCopied(false);
    onClose();
  }

  const copy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title", { email: target?.email ?? "" })}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {issued ? (
          <>
            <Alert tone="success" title={t("done")}>
              <p>{t("doneHint")}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-[var(--radius-sm)] bg-surface-2 px-2 py-1 font-mono text-xs">{issued}</code>
                <Button size="icon" variant="outline" onClick={() => void copy()} aria-label={copied ? t("copied") : t("copy")}>
                  {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                </Button>
              </div>
            </Alert>
            <DialogFooter>
              <Button onClick={close}>{t("dismiss")}</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (target && canSubmit) void reset.run(target.id, password);
            }}
          >
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              loading={reset.pending}
              onClick={() => {
                if (target) void reset.run(target.id);
              }}
            >
              <Wand2 className="size-4" aria-hidden /> {t("generate")}
            </Button>
            <p className="text-center text-xs text-fg-muted">{t("orType")}</p>
            <AuthField id={`${ids}-password`} label={t("password")} error={short ? t("short") : null}>
              {(a11y) => (
                <PasswordInput {...a11y} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} />
              )}
            </AuthField>
            <AuthField id={`${ids}-confirm`} label={t("confirm")} error={mismatch ? t("mismatch") : null}>
              {(a11y) => (
                <PasswordInput {...a11y} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} />
              )}
            </AuthField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={close} disabled={reset.pending}>
                {tc("cancel")}
              </Button>
              <Button type="submit" loading={reset.pending} disabled={!canSubmit}>
                {t("submit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
