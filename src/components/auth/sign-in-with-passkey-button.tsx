"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import {
  finishPasskeyAuthenticationAction,
  startPasskeyAuthenticationAction,
} from "@/server/actions/passkeys";

export function SignInWithPasskeyButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signInWithPasskey() {
    setBusy(true);
    try {
      const init = await startPasskeyAuthenticationAction();
      if (!init.ok) {
        toast.error(init.error);
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
        toast.success("Signed in");
        router.push("/");
        router.refresh();
      } else {
        toast.error(r.error ?? "Sign-in failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cancelled";
      if (!/cancel/i.test(msg) && !/AbortError/.test(msg)) toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      onClick={signInWithPasskey}
      disabled={busy}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
      Sign in with passkey
    </Button>
  );
}
