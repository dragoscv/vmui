"use client";

import { useEffect, useState, useTransition } from "react";
import { Fingerprint, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { startRegistration } from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import {
  deletePasskeyAction,
  finishPasskeyRegistrationAction,
  listPasskeysAction,
  startPasskeyRegistrationAction,
  type PasskeySummary,
} from "@/server/actions/passkeys";

function relative(d: Date | null): string {
  if (!d) return "never";
  const diff = Math.max(0, Date.now() - new Date(d).getTime());
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function PasskeysCard() {
  const [rows, setRows] = useState<PasskeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [pending, start] = useTransition();

  async function refresh() {
    setRows(await listPasskeysAction());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function add() {
    setAdding(true);
    try {
      const init = await startPasskeyRegistrationAction();
      if (!init.ok) {
        toast.error(init.error);
        return;
      }
      const response = await startRegistration({
        optionsJSON: init.options as PublicKeyCredentialCreationOptionsJSON,
      });
      const r = await finishPasskeyRegistrationAction({
        challengeKey: init.challengeKey,
        label: label.trim() || "Passkey",
        response,
      });
      if (r.ok) {
        toast.success("Passkey added");
        setLabel("");
        await refresh();
      } else {
        toast.error(r.error ?? "Failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cancelled";
      if (!/cancel/i.test(msg) && !/AbortError/.test(msg)) {
        toast.error(msg);
      }
    } finally {
      setAdding(false);
    }
  }

  function remove(id: string, label: string) {
    if (!confirm(`Remove passkey "${label}"?`)) return;
    start(async () => {
      const r = await deletePasskeyAction(id);
      if (r.ok) {
        toast.success("Passkey removed");
        await refresh();
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading passkeys…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted">No passkeys yet. Add one to skip the password on sign-in.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)]">
          {rows.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-muted" />
                <span className="truncate font-medium">{p.label}</span>
                <span className="text-[11px] text-muted">
                  · added {relative(p.createdAt)} · last used {relative(p.lastUsedAt)}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(p.id, p.label)}
                disabled={pending}
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. MacBook Touch ID)"
          maxLength={60}
          className="flex-1 text-xs"
          disabled={adding}
        />
        <Button onClick={add} disabled={adding} size="sm">
          {adding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Fingerprint className="h-3.5 w-3.5" />
          )}
          <Plus className="h-3 w-3" /> Add passkey
        </Button>
      </div>
    </div>
  );
}
