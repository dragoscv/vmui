"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Send, MessageCircle, Hash, Bell, Webhook, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createAlertChannelAction,
  deleteAlertChannelAction,
  testAlertChannelAction,
} from "@/server/actions/alerts";
import type { AlertChannelRow } from "@/lib/db/schema";

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  toast: Bell,
  discord: MessageCircle,
  slack: Hash,
  ntfy: Bell,
  webhook: Webhook,
  smtp: Mail,
};

interface Props {
  channels: AlertChannelRow[];
}

type Kind = "toast" | "discord" | "slack" | "ntfy" | "webhook" | "smtp";

export function AlertChannelsPanel({ channels }: Props) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>("discord");
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const setF = (k: string, v: string) => setFields((s) => ({ ...s, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    let channel: Parameters<typeof createAlertChannelAction>[0]["channel"];
    try {
      switch (kind) {
        case "toast":
          channel = { kind: "toast" };
          break;
        case "discord":
          channel = { kind: "discord", webhookUrl: fields.webhookUrl ?? "", username: fields.username || undefined };
          break;
        case "slack":
          channel = { kind: "slack", webhookUrl: fields.webhookUrl ?? "", channel: fields.channel || undefined };
          break;
        case "ntfy":
          channel = {
            kind: "ntfy",
            baseUrl: fields.baseUrl ?? "https://ntfy.sh",
            topic: fields.topic ?? "",
            token: fields.token || undefined,
          };
          break;
        case "webhook":
          channel = {
            kind: "webhook",
            url: fields.url ?? "",
            hmacSecret: fields.hmacSecret || undefined,
          };
          break;
        case "smtp":
          channel = {
            kind: "smtp",
            host: fields.host ?? "",
            port: Number(fields.port ?? "587"),
            secure: fields.secure === "true",
            username: fields.username || undefined,
            password: fields.password || undefined,
            from: fields.from ?? "",
            to: fields.to ?? "",
          };
          break;
      }
    } catch {
      toast.error("Invalid input");
      return;
    }
    startTransition(async () => {
      const out = await createAlertChannelAction({ name, channel });
      if (out.ok) {
        toast.success("Channel created");
        setAdding(false);
        setName("");
        setFields({});
      } else {
        toast.error(out.error ?? "Create failed");
      }
    });
  };

  const remove = (id: string) => {
    if (!confirm("Delete this channel?")) return;
    startTransition(async () => {
      await deleteAlertChannelAction({ id });
      toast.success("Deleted");
    });
  };

  const test = (id: string) => {
    startTransition(async () => {
      const out = await testAlertChannelAction({ id });
      if (out.ok) toast.success("Test alert sent");
      else toast.error(out.error ?? "Test failed");
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Channels</CardTitle>
        <Button size="sm" onClick={() => setAdding((s) => !s)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> {adding ? "Cancel" : "Add"}
        </Button>
      </CardHeader>
      <CardContent>
        {adding && (
          <form onSubmit={submit} className="mb-4 space-y-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs">
            <div className="grid gap-2 sm:grid-cols-2">
              <label>
                <span className="mb-0.5 block font-medium">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1" />
              </label>
              <label>
                <span className="mb-0.5 block font-medium">Kind</span>
                <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
                  <option value="toast">Toast / browser notif</option>
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="ntfy">ntfy.sh</option>
                  <option value="webhook">Generic webhook</option>
                  <option value="smtp">Email (SMTP)</option>
                </select>
              </label>
            </div>
            {kind === "discord" && (
              <>
                <Field label="Webhook URL" value={fields.webhookUrl} onChange={(v) => setF("webhookUrl", v)} required />
                <Field label="Username (optional)" value={fields.username} onChange={(v) => setF("username", v)} />
              </>
            )}
            {kind === "slack" && (
              <>
                <Field label="Webhook URL" value={fields.webhookUrl} onChange={(v) => setF("webhookUrl", v)} required />
                <Field label="Channel (optional)" value={fields.channel} onChange={(v) => setF("channel", v)} />
              </>
            )}
            {kind === "ntfy" && (
              <>
                <Field label="Base URL" value={fields.baseUrl ?? "https://ntfy.sh"} onChange={(v) => setF("baseUrl", v)} />
                <Field label="Topic" value={fields.topic} onChange={(v) => setF("topic", v)} required />
                <Field label="Token (optional)" value={fields.token} onChange={(v) => setF("token", v)} type="password" />
              </>
            )}
            {kind === "webhook" && (
              <>
                <Field label="URL" value={fields.url} onChange={(v) => setF("url", v)} required />
                <Field label="HMAC secret (optional)" value={fields.hmacSecret} onChange={(v) => setF("hmacSecret", v)} type="password" />
              </>
            )}
            {kind === "smtp" && (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Host" value={fields.host} onChange={(v) => setF("host", v)} required />
                  <Field label="Port" value={fields.port ?? "587"} onChange={(v) => setF("port", v)} required />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Username" value={fields.username} onChange={(v) => setF("username", v)} />
                  <Field label="Password" value={fields.password} onChange={(v) => setF("password", v)} type="password" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="From" value={fields.from} onChange={(v) => setF("from", v)} required />
                  <Field label="To" value={fields.to} onChange={(v) => setF("to", v)} required />
                </div>
              </>
            )}
            <Button type="submit" size="sm" disabled={pending}>
              Save channel
            </Button>
          </form>
        )}

        {channels.length === 0 ? (
          <div className="grid place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-6 text-xs text-muted">
            No channels yet. Add Discord, Slack, ntfy, SMTP, webhook, or browser-toast.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {channels.map((c) => {
              const Icon = KIND_ICON[c.kind] ?? Bell;
              return (
                <li key={c.id} className="flex items-center gap-3 py-2 text-xs">
                  <Icon className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted">[{c.kind}]</span>
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => test(c.id)} disabled={pending}>
                    <Send className="mr-1 h-3 w-3" /> Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id)} disabled={pending} className="text-red-600 hover:bg-red-500/10 dark:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block font-medium">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
      />
    </label>
  );
}
