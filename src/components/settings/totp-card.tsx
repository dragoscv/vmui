"use client";

import { useEffect, useState, useTransition } from "react";
import { ShieldCheck, ShieldOff, Loader2, KeyRound, Copy, RefreshCcw, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  confirmTotpEnrollmentAction,
  disableTotpAction,
  getTotpStatusAction,
  pingTotpAction,
  regenerateBackupCodesAction,
  startTotpEnrollmentAction,
  type TotpStatus,
} from "@/server/actions/totp";

type Stage =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "enrolling"; qr: string; secret: string; enrollmentId: string; code: string }
  | { kind: "on"; status: TotpStatus };

export function TotpCard() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [pending, start] = useTransition();
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  async function refresh() {
    const status = await getTotpStatusAction();
    setStage(status.enrolled ? { kind: "on", status } : { kind: "off" });
  }

  useEffect(() => {
    refresh();
  }, []);

  function enroll() {
    start(async () => {
      const r = await startTotpEnrollmentAction();
      if (r.ok) {
        setStage({ kind: "enrolling", qr: r.qrDataUrl, secret: r.secret, enrollmentId: r.enrollmentId, code: "" });
      } else {
        toast.error(r.error);
      }
    });
  }

  function confirm() {
    if (stage.kind !== "enrolling") return;
    const enrollmentId = stage.enrollmentId;
    const code = stage.code;
    start(async () => {
      const r = await confirmTotpEnrollmentAction({ enrollmentId, code });
      if (r.ok) {
        setNewCodes(r.backupCodes);
        toast.success("2FA enabled");
        await refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  function disable() {
    const password = prompt("Confirm your password to disable 2FA:") ?? "";
    if (!password) return;
    start(async () => {
      const r = await disableTotpAction({ password });
      if (r.ok) {
        toast.success("2FA disabled");
        setNewCodes(null);
        await refresh();
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  function regenerate() {
    const password = prompt("Confirm your password to regenerate backup codes:") ?? "";
    if (!password) return;
    start(async () => {
      const r = await regenerateBackupCodesAction({ password });
      if (r.ok) {
        setNewCodes(r.codes);
        toast.success("New backup codes generated");
        await refresh();
      } else {
        toast.error(r.error);
      }
    });
  }

  async function testCode() {
    const code = prompt("Enter the 6-digit code from your authenticator:") ?? "";
    if (!code) return;
    const r = await pingTotpAction({ code: code.trim() });
    if (r.ok) toast.success("Code matches — your authenticator is in sync.");
    else toast.error("Code did not match.");
  }

  async function copyCodes() {
    if (!newCodes) return;
    await navigator.clipboard.writeText(newCodes.join("\n"));
    toast.success("Backup codes copied");
  }

  if (stage.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading 2FA status…
      </div>
    );
  }

  if (stage.kind === "off") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">
          Add a second factor (Google Authenticator, 1Password, Authy, Bitwarden…) so a stolen password isn&apos;t enough to sign in.
        </p>
        <Button onClick={enroll} disabled={pending} size="sm">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Enable 2FA
        </Button>
      </div>
    );
  }

  if (stage.kind === "enrolling") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.qr} alt="TOTP QR" width={180} height={180} className="rounded-md border border-[var(--color-border)] bg-white p-1" />
          <div className="space-y-2 text-xs">
            <p className="text-muted">1. Scan the QR with your authenticator.</p>
            <p className="text-muted">
              Or paste this secret manually:
              <code className="ml-1 break-all rounded bg-[var(--color-bg)] px-1 py-0.5 font-mono">{stage.secret}</code>
            </p>
            <p className="text-muted">2. Enter the current 6-digit code:</p>
            <div className="flex items-center gap-2">
              <Input
                value={stage.code}
                onChange={(e) => setStage({ ...stage, code: e.target.value })}
                placeholder="123456"
                inputMode="numeric"
                maxLength={10}
                className="w-32 font-mono"
              />
              <Button onClick={confirm} disabled={pending || stage.code.length < 6} size="sm">
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Verify & enable
              </Button>
              <Button onClick={() => setStage({ kind: "off" })} variant="ghost" size="sm">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // stage.kind === "on"
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <Badge variant="success">enabled</Badge>
        <span className="text-muted">
          Enrolled {stage.status.verifiedAt ? new Date(stage.status.verifiedAt).toLocaleDateString() : "—"} · {stage.status.backupCodesRemaining} backup code
          {stage.status.backupCodesRemaining === 1 ? "" : "s"} remaining
        </span>
      </div>
      {newCodes && (
        <div className="space-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium">Save these backup codes</span>
            <Button onClick={copyCodes} size="sm" variant="ghost">
              <Copy className="h-3 w-3" /> Copy all
            </Button>
          </div>
          <p className="text-muted">
            Each code works once. Keep them in your password manager — they replace the old codes.
          </p>
          <ul className="grid grid-cols-2 gap-1 pt-1 font-mono">
            {newCodes.map((c) => (
              <li key={c} className="rounded bg-[var(--color-surface)] px-2 py-1">{c}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={testCode} variant="ghost" size="sm">
          <KeyRound className="h-3.5 w-3.5" /> Test code
        </Button>
        <Button onClick={regenerate} variant="ghost" size="sm" disabled={pending}>
          <RefreshCcw className="h-3.5 w-3.5" /> Regenerate backup codes
        </Button>
        <Button onClick={disable} variant="ghost" size="sm" disabled={pending} className="text-[var(--color-danger)]">
          <ShieldOff className="h-3.5 w-3.5" /> Disable 2FA
        </Button>
      </div>
    </div>
  );
}
