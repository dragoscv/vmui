"use client";

import { useActionState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { signInAction, verifyTotpAction, type SignInState } from "@/server/actions/auth";

const initial: SignInState = undefined;

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initial);
  const [totpState, totpFormAction, totpPending] = useActionState(verifyTotpAction, initial);

  // Once a sign-in returns pending2FA, switch the form to the code prompt.
  // Subsequent failures on verifyTotpAction also carry pending2FA so the user
  // can retry without re-entering the password.
  const challenge = totpState?.pending2FA ?? state?.pending2FA ?? null;
  const challengeEmail = totpState?.pendingEmail ?? state?.pendingEmail ?? "";

  if (challenge) {
    return (
      <form action={totpFormAction} className="space-y-3">
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-primary)_8%,transparent)] px-3 py-2 text-xs">
          <ShieldCheck className="h-4 w-4 text-[var(--color-primary)]" />
          <span>
            Two-factor required for <strong>{challengeEmail}</strong>.
          </span>
        </div>
        <input type="hidden" name="token" value={challenge} />
        <div className="space-y-1.5">
          <Label htmlFor="code">Authenticator code or backup code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            placeholder="123456"
          />
        </div>
        {totpState?.error && (
          <div className="rounded bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {totpState.error}
          </div>
        )}
        <Button type="submit" disabled={totpPending} className="w-full">
          {totpPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
        </Button>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error && (
        <div className="rounded bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {state.error}
        </div>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </Button>
    </form>
  );
}
