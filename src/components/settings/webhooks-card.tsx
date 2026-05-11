"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2, Webhook, Zap, History as HistoryIcon } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteWebhookAction,
  recentWebhookDeliveriesAction,
  testWebhookAction,
  upsertWebhookAction,
  type WebhookDelivery,
} from "@/server/actions/webhooks";
import type { WebhookRow } from "@/lib/db/schema";

const ALL_CHANNELS = [
  "instance.changed",
  "sync.completed",
  "snapshot.created",
  "notification.created",
] as const;
type Channel = (typeof ALL_CHANNELS)[number];
type Kind = "slack" | "discord" | "generic";

interface Draft {
  id?: string;
  name: string;
  url: string;
  kind: Kind;
  channels: Channel[];
  enabled: boolean;
  cooldownSec: number | null;
}

function parseChannels(json: string): Channel[] {
  try {
    const arr = JSON.parse(json) as unknown;
    if (Array.isArray(arr)) return arr.filter((s): s is Channel => ALL_CHANNELS.includes(s as Channel));
  } catch {
    // ignore
  }
  return [];
}

function toDraft(row: WebhookRow): Draft {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind as Kind,
    channels: parseChannels(row.channels),
    enabled: row.enabled === 1,
    cooldownSec: row.cooldownSec ?? null,
  };
}

export function WebhooksCard({ initial }: { initial: WebhookRow[] }) {
  const [rows, setRows] = useState<WebhookRow[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();
  const [testingId, setTestingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<WebhookDelivery[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function toggleHistory(id: string) {
    if (historyId === id) {
      setHistoryId(null);
      return;
    }
    setHistoryId(id);
    setHistoryLoading(true);
    try {
      const rows = await recentWebhookDeliveriesAction(id, 10);
      setHistory(rows);
    } finally {
      setHistoryLoading(false);
    }
  }

  function newDraft() {
    setDraft({
      name: "",
      url: "",
      kind: "slack",
      channels: ["instance.changed"],
      enabled: true,
      cooldownSec: null,
    });
  }

  function save() {
    if (!draft) return;
    start(async () => {
      const r = await upsertWebhookAction(draft);
      if (!r.ok) {
        toast.error("Save failed", { description: r.error });
        return;
      }
      toast.success("Webhook saved");
      setDraft(null);
      // Optimistic reload via refresh — server action already revalidated.
      const id = r.id!;
      const row: WebhookRow = {
        id,
        name: draft.name,
        url: draft.url,
        kind: draft.kind,
        channels: JSON.stringify(draft.channels),
        enabled: draft.enabled ? 1 : 0,
        cooldownSec: draft.cooldownSec ?? null,
        createdAt: new Date(),
        lastFiredAt: null,
        lastStatus: null,
      };
      setRows((prev) => {
        const idx = prev.findIndex((p) => p.id === id);
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = { ...prev[idx]!, ...row };
          return copy;
        }
        return [...prev, row];
      });
    });
  }

  async function remove(id: string) {
    await deleteWebhookAction(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  async function test(id: string) {
    setTestingId(id);
    const r = await testWebhookAction({ id });
    setTestingId(null);
    if (r.ok) toast.success(`Test sent (HTTP ${r.status ?? "ok"})`);
    else toast.error("Test failed", { description: r.error });
  }

  function toggleChannel(c: Channel) {
    if (!draft) return;
    const next = draft.channels.includes(c)
      ? draft.channels.filter((x) => x !== c)
      : [...draft.channels, c];
    setDraft({ ...draft, channels: next });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Webhook className="h-4 w-4" /> Webhooks
            </CardTitle>
            <CardDescription>
              Forward instance and snapshot events to Slack, Discord, or any HTTPS endpoint.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={newDraft}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && !draft && (
          <p className="text-xs text-muted">No webhooks configured.</p>
        )}
        {rows.map((row) => (
          <div key={row.id} className="space-y-2">
            <div className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3 text-xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted">{row.kind}</span>
                  {row.enabled === 0 && <span className="text-muted">(disabled)</span>}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{row.url}</div>
                <div className="mt-0.5 text-[10px] text-muted">
                  channels: {parseChannels(row.channels).join(", ") || "—"} ·
                  last: {row.lastStatus ?? "never"}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggleHistory(row.id)}
                title="Recent deliveries"
              >
                <HistoryIcon className="h-3.5 w-3.5" /> Log
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => test(row.id)}
                disabled={testingId === row.id || row.enabled === 0}
                title="Send test ping"
              >
                {testingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Test
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(row))}>
                Edit
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted hover:text-[var(--color-danger)]"
                onClick={() => remove(row.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {historyId === row.id && (
              <div className="ml-3 rounded-md border border-dashed border-[var(--color-border)] p-2 text-[11px]">
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading deliveries…
                  </div>
                ) : history.length === 0 ? (
                  <p className="text-muted">No deliveries yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {history.map((h) => (
                      <li key={h.id} className="flex items-center gap-2 font-mono">
                        <span
                          className={
                            h.status === "ok"
                              ? "text-[var(--color-success)]"
                              : "text-[var(--color-danger)]"
                          }
                        >
                          {h.status.padEnd(5, " ")}
                        </span>
                        <span className="text-muted">
                          {new Date(h.createdAt).toLocaleString()}
                        </span>
                        <span className="truncate">{h.message ?? ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
        {draft && (
          <div className="space-y-3 rounded-md border border-dashed border-[var(--color-border)] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="prod alerts"
                  className="text-xs"
                  maxLength={80}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Kind</Label>
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}
                  className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-xs"
                >
                  <option value="slack">Slack</option>
                  <option value="discord">Discord</option>
                  <option value="generic">Generic JSON</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">URL</Label>
              <Input
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://hooks.slack.com/..."
                type="url"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Channels</Label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_CHANNELS.map((c) => {
                  const on = draft.channels.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleChannel(c)}
                      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] transition ${
                        on
                          ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)] text-[var(--color-primary)]"
                          : "border-[var(--color-border)] text-muted hover:text-fg"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-[11px] text-muted">
              <span>Cooldown</span>
              <input
                type="number"
                min="0"
                max="86400"
                step="1"
                value={draft.cooldownSec ?? ""}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  const n = v === "" ? null : Number.parseInt(v, 10);
                  setDraft({ ...draft, cooldownSec: Number.isFinite(n) ? n : null });
                }}
                placeholder="0"
                className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs"
              />
              <span>sec between deliveries</span>
            </label>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={pending || !draft.name.trim() || !draft.url.trim()}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
