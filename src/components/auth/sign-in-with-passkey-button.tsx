"use client";

import { translateAuthError } from "@/components/auth/auth-errors";
import { Button } from "@/components/ui/button";
import {
    finishPasskeyAuthenticationAction,
    startPasskeyAuthenticationAction,
} from "@/server/actions/passkeys";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { startAuthentication } from "@simplewebauthn/browser";
import { Fingerprint } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function SignInWithPasskeyButton() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signInWithPasskey() {
    setBusy(true);
    try {
      const init = await startPasskeyAuthenticationAction();
      if (!init.ok) {
        toast.error(translateAuthError(t, init.error));
        return;
      }
      const response = await startAuthentication({
        optionsJSON: init.options as PublicKeyCredentialRequestOptionsJSON,
      });
      const r = await finishPasskeyAuthenticationAction({
        challengeKey: init.challengeKey,
        response,
      });
      if (r.ok) {
        toast.success(t("passkey.signedIn"));
        router.push("/");
        router.refresh();
      } else {
        toast.error(translateAuthError(t, r.error) ?? t("errors.verificationFailed"));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const cancelled = !msg || /cancel/i.test(msg) || /AbortError|NotAllowedError/.test(msg) || (err instanceof Error && err.name === "NotAllowedError");
      if (!cancelled) toast.error(t("errors.generic", { message: msg }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" variant="outline" className="w-full" onClick={signInWithPasskey} loading={busy}>
      <Fingerprint className="size-4" aria-hidden />
      {t("passkey.button")}
    </Button>
  );
}
