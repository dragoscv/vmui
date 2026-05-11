"use client";

import { useState, useTransition } from "react";
import { Trash2, Plus, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { createApiKeyAction, revokeApiKeyAction } from "@/server/actions/api-keys";

export type ApiKeyView = {
  id: string;
  name: string;
  role: "operator" | "viewer";
  rateLimitPerMinute: number;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

export function ApiKeysManager({ keys }: { keys: ApiKeyView[] }) {
  const [pending, start] = useTransition();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"operator" | "viewer">("viewer");
  const [rate, setRate] = useState(60);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = () => {
    if (!name.trim()) return;
    start(async () => {
      const r = await createApiKeyAction({ name: name.trim(), role, rateLimitPerMinute: rate });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setIssued(r.plaintext);
      setName("");
      toast.success("API key created — copy it now");
    });
  };

  const revoke = (id: string, displayName: string) => {
    if (!confirm(`Revoke key "${displayName}"? This cannot be undone.`)) return;
    start(async () => {
      const r = await revokeApiKeyAction(id);
      if (!r.ok) toast.error(r.error ?? "Failed");
      else toast.success("Key revoked");
    });
  };

  const copy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3">
      {issued && (
        <div className="rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm">
          <p className="mb-2 font-medium">New API key — copy now, it will not be shown again:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-[var(--color-surface-2)] px-2 py-1 text-xs">
              {issued}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">{keys.length} key(s)</p>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="mr-1 h-3 w-3" /> New key
        </Button>
      </div>

      {showCreate && (
        <div className="space-y-2 rounded border border-[var(--color-border)] p-3">
          <Input
            placeholder="Key name (e.g. terraform-prod)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              Role:
              <select
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface-1)] px-2 py-1"
                value={role}
                onChange={(e) => setRole(e.target.value as "operator" | "viewer")}
              >
                <option value="viewer">viewer</option>
                <option value="operator">operator</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              Rate/min:
              <Input
                type="number"
                min={1}
                max={10000}
                className="w-24"
                value={rate}
                onChange={(e) => setRate(parseInt(e.target.value, 10) || 60)}
              />
            </label>
            <Button size="sm" onClick={create} disabled={pending || !name.trim()}>
              Create
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1">
        {keys.length === 0 && <p className="text-sm text-muted">No keys yet.</p>}
        {keys.map((k) => (
          <div
            key={k.id}
            className="flex items-center justify-between rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            <div className="flex flex-1 items-center gap-2">
              <span className="font-medium">{k.name}</span>
              <Badge variant={k.role === "operator" ? "info" : "muted"}>{k.role}</Badge>
              <span className="text-xs text-muted">{k.rateLimitPerMinute}/min</span>
              {k.revokedAt && <Badge variant="danger">revoked</Badge>}
              {k.lastUsedAt && (
                <span className="text-xs text-muted">
                  last used {new Date(k.lastUsedAt).toLocaleString()}
                </span>
              )}
            </div>
            {!k.revokedAt && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => revoke(k.id, k.name)}
                disabled={pending}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
