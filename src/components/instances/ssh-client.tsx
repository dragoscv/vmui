"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, KeyRound, Loader2, Terminal, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TerminalView } from "@/components/instances/terminal-view";
import {
  openCustomSshAction,
  openLocalKvmSshAction,
  openSavedKeySshAction,
  reconnectSshSessionAction,
} from "@/server/actions/ssh";
import type { InstanceRow } from "@/lib/db/schema";

export interface SavedKeyOption {
  id: string;
  name: string;
  algo: string;
  hasPrivate: boolean;
}

const TTL_OPTIONS = [
  { label: "5m", ms: 5 * 60_000 },
  { label: "15m", ms: 15 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "4h", ms: 4 * 60 * 60_000 },
  { label: "8h", ms: 8 * 60 * 60_000 },
] as const;
const DEFAULT_TTL_MS = 60 * 60_000;

export function SshClient({ instance, savedKeys = [] }: { instance: InstanceRow; savedKeys?: SavedKeyOption[] }) {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ttlMs, setTtlMs] = useState<number>(DEFAULT_TTL_MS);

  const usableKeys = savedKeys.filter((k) => k.hasPrivate);
  const [savedKeyId, setSavedKeyId] = useState<string>(usableKeys[0]?.id ?? "");
  const [mode, setMode] = useState<"saved" | "paste">(usableKeys.length > 0 ? "saved" : "paste");

  // Custom-SSH form state (for AWS/Azure/GCP).
  const [username, setUsername] = useState(defaultUserFor(instance));
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");

  const isLocal = instance.provider === "local-kvm";

  const openLocal = useCallback(async () => {
    setError(null);
    setLoading(true);
    const r = await openLocalKvmSshAction({
      accountId: instance.accountId,
      providerInstanceId: instance.providerInstanceId,
      ttlMs,
    });
    setLoading(false);
    if (r.ok) {
      setWsUrl(r.wsUrl);
      setSessionId(r.sessionId);
      setExpiresAt(r.expiresAt);
    } else setError(r.error);
  }, [instance.accountId, instance.providerInstanceId, ttlMs]);

  const reconnect = useCallback(async () => {
    if (!sessionId) {
      // Local sessions can be re-opened from scratch (creds are stored).
      if (isLocal) {
        setWsUrl(null);
        return openLocal();
      }
      setWsUrl(null);
      return;
    }
    setError(null);
    setLoading(true);
    const r = await reconnectSshSessionAction({ sessionId });
    setLoading(false);
    if (r.ok) {
      setWsUrl(r.wsUrl);
      setExpiresAt(r.expiresAt);
    } else {
      // Session expired — force credential re-entry.
      setSessionId(null);
      setWsUrl(null);
      setError(r.error);
    }
  }, [sessionId, isLocal, openLocal]);

  async function openCustom() {
    if (mode === "saved") {
      if (!username || !savedKeyId) {
        setError("Username and a saved key are required.");
        return;
      }
      setError(null);
      setLoading(true);
      const r = await openSavedKeySshAction({
        accountId: instance.accountId,
        providerInstanceId: instance.providerInstanceId,
        username,
        sshKeyId: savedKeyId,
        ttlMs,
      });
      setLoading(false);
      if (r.ok) {
        setWsUrl(r.wsUrl);
        setSessionId(r.sessionId);
        setExpiresAt(r.expiresAt);
      } else setError(r.error);
      return;
    }
    if (!username || !privateKey) {
      setError("Username and private key are required.");
      return;
    }
    setError(null);
    setLoading(true);
    const r = await openCustomSshAction({
      accountId: instance.accountId,
      providerInstanceId: instance.providerInstanceId,
      username,
      privateKey,
      passphrase: passphrase || undefined,
      ttlMs,
    });
    setLoading(false);
    if (r.ok) {
      setWsUrl(r.wsUrl);
      setSessionId(r.sessionId);
      setExpiresAt(r.expiresAt);
    } else setError(r.error);
  }

  useEffect(() => {
    if (isLocal) void openLocal();
  }, [isLocal, openLocal]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/instances/${encodeURIComponent(instance.id)}`}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="flex items-center gap-2 text-sm">
          <Terminal className="h-4 w-4 text-[var(--color-primary)]" />
          <span className="font-medium">{instance.name ?? instance.providerInstanceId}</span>
          <span className="text-muted">· {instance.provider} · {instance.region}</span>
        </div>
      </div>

      {wsUrl ? (
        <>
          {expiresAt && <SessionExpiryBar expiresAt={expiresAt} />}
          <TerminalView
            wsUrl={wsUrl}
            label={`${username}@${instance.publicIp ?? instance.publicDns ?? "127.0.0.1"}`}
            onReconnect={reconnect}
          />
        </>
      ) : isLocal ? (
        <div className="flex h-[60vh] items-center justify-center text-sm text-muted">
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening session…</> : error ? (
            <div className="text-center text-[var(--color-danger)]">{error}</div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="text-base font-semibold">Provide SSH credentials</h2>
          <p className="mb-4 text-xs text-muted">
            Your private key is held in server memory only for the lifetime of this session — it never touches disk
            and can't be re-used after the WebSocket closes.
          </p>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> Session duration
              </Label>
              <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5 w-fit">
                {TTL_OPTIONS.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => setTtlMs(o.ms)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                      ttlMs === o.ms ? "bg-white/10 text-fg" : "text-muted hover:text-fg"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted">
                How long this session can be reconnected without re-entering credentials. Tokens for the WebSocket
                itself are still single-use and expire 60s after issuance.
              </p>
            </div>
            {usableKeys.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setMode("saved")}
                  className={`rounded-full border px-2 py-0.5 ${mode === "saved" ? "border-[var(--color-primary)]/60 bg-[var(--color-primary)]/10" : "border-[var(--color-border)] text-muted"}`}
                >
                  Use saved key
                </button>
                <button
                  type="button"
                  onClick={() => setMode("paste")}
                  className={`rounded-full border px-2 py-0.5 ${mode === "paste" ? "border-[var(--color-primary)]/60 bg-[var(--color-primary)]/10" : "border-[var(--color-border)] text-muted"}`}
                >
                  Paste key
                </button>
              </div>
            )}
            {mode === "saved" && usableKeys.length > 0 ? (
              <div className="grid gap-1.5">
                <Label htmlFor="sshKeyId">Saved key</Label>
                <select
                  id="sshKeyId"
                  value={savedKeyId}
                  onChange={(e) => setSavedKeyId(e.target.value)}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
                >
                  {usableKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} ({k.algo})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="privateKey">Private key (PEM)</Label>
                  <textarea
                    id="privateKey"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                    className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 font-mono text-[11px]"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="passphrase">Passphrase (optional)</Label>
                  <Input id="passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                </div>
              </>
            )}
            <div>
              <Button onClick={openCustom} disabled={loading || !username || (mode === "saved" ? !savedKeyId : !privateKey)}>
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</> : <><KeyRound className="h-4 w-4" /> Connect</>}
              </Button>
            </div>
            {error && (
              <div className="rounded-md bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] p-2 text-xs text-[var(--color-danger)]">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function defaultUserFor(inst: InstanceRow): string {
  if (inst.provider === "aws") return inst.platform === "linux" ? "ec2-user" : "ec2-user";
  if (inst.provider === "azure") return "azureuser";
  if (inst.provider === "gcp") return "ubuntu";
  if (inst.provider === "scaleway") return "m1";
  if (inst.provider === "digitalocean") return "root";
  return "ubuntu";
}

function SessionExpiryBar({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const remainingMs = Math.max(0, expiresAt - now);
  if (remainingMs === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] px-3 py-1.5 text-xs text-[var(--color-danger)]">
        <Clock className="h-3.5 w-3.5" /> Session expired — Reconnect will require re-entering credentials.
      </div>
    );
  }
  const min = Math.floor(remainingMs / 60_000);
  const sec = Math.floor((remainingMs % 60_000) / 1000);
  const label = min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : min >= 1 ? `${min}m` : `${sec}s`;
  return (
    <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-muted">
      <Clock className="h-3.5 w-3.5" /> Session reconnect window: {label} remaining
    </div>
  );
}
