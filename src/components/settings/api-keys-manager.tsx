"use client";

import { Alert, Badge, Button, DataTable, EmptyState, Field, Input, PageSection, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { createApiKeyAction, revokeApiKeyAction } from "@/server/actions/api-keys";
import { Check, Copy, Key, Plus, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toError, toResult } from "./adapt";
import { RelativeTime } from "./relative-time";

export type ApiKeyView = {
  id: string;
  name: string;
  role: "operator" | "viewer";
  rateLimitPerMinute: number;
  createdAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

const ROLES = ["viewer", "operator"] as const;

export function ApiKeysManager({ keys }: { keys: ApiKeyView[] }) {
  const t = useTranslations("settings.access.apiKeys");
  const tr = useTranslations("auth.roles");
  const format = useFormatter();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [role, setRole] = useState<"operator" | "viewer">("viewer");
  const [rate, setRate] = useState(60);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useAction(
    async (): Promise<ActionResult<string>> => {
      const r = await createApiKeyAction({ name: name.trim(), role, rateLimitPerMinute: rate });
      return r.ok ? ok(r.plaintext) : toError(r);
    },
    {
      success: t("created"),
      onSuccess: (plaintext) => {
        setIssued(plaintext);
        setName("");
      },
    },
  );

  const revoke = useAction(async (id: string) => toResult(await revokeApiKeyAction(id)), { success: t("revoked") });

  async function onRevoke(k: ApiKeyView) {
    const yes = await confirm({
      title: t("confirmRevoke", { name: k.name }),
      description: t("confirmRevokeHint"),
      tone: "danger",
      confirmText: t("revoke"),
    });
    if (yes) await revoke.run(k.id);
  }

  const copy = async () => {
    if (!issued) return;
    await navigator.clipboard.writeText(issued);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const columns = useMemo<ColumnDef<ApiKeyView, unknown>[]>(
    () => [
      { accessorKey: "name", header: t("columns.name"), cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      {
        accessorKey: "role",
        header: t("columns.role"),
        cell: ({ row }) => <Badge variant={row.original.role === "operator" ? "info" : "muted"}>{tr(row.original.role)}</Badge>,
      },
      {
        accessorKey: "rateLimitPerMinute",
        header: t("columns.rate"),
        cell: ({ row }) => <span className="tabular-nums text-fg-muted">{t("perMinute", { n: row.original.rateLimitPerMinute })}</span>,
      },
      {
        accessorKey: "createdAt",
        header: t("columns.created"),
        cell: ({ row }) => <span className="whitespace-nowrap text-fg-muted">{format.dateTime(new Date(row.original.createdAt), { dateStyle: "medium" })}</span>,
      },
      {
        accessorKey: "lastUsedAt",
        header: t("columns.lastUsed"),
        cell: ({ row }) =>
          row.original.lastUsedAt ? (
            <RelativeTime date={row.original.lastUsedAt} className="whitespace-nowrap text-fg-muted" />
          ) : (
            <span className="text-fg-muted">{t("neverUsed")}</span>
          ),
      },
      {
        id: "status",
        accessorFn: (k) => (k.revokedAt ? "revoked" : "active"),
        header: t("columns.status"),
        cell: ({ row }) =>
          row.original.revokedAt ? <Badge variant="danger">{t("revokedBadge")}</Badge> : <Badge variant="success">{t("active")}</Badge>,
      },
    ],
    [t, tr, format],
  );

  return (
    <div className="space-y-4">
      {issued && (
        <Alert
          tone="success"
          title={t("issuedTitle")}
          action={
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              {t("dismiss")}
            </Button>
          }
        >
          <p>{t("issuedHint")}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-[var(--radius-sm)] bg-surface-2 px-2 py-1 font-mono text-xs">{issued}</code>
            <Button size="icon" variant="outline" onClick={() => void copy()} aria-label={t("copy")}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            </Button>
          </div>
        </Alert>
      )}

      <PageSection title={t("createTitle")} description={t("createDescription")}>
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create.run();
          }}
        >
          <Field label={t("name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} required />
          </Field>
          <Field label={t("role")}>
            <Select value={role} onValueChange={(v) => setRole(v as "operator" | "viewer")}>
              <SelectTrigger aria-label={t("role")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {tr(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("rateLimit")} hint={t("rateLimitHint")}>
            <Input
              type="number"
              min={1}
              max={10000}
              value={rate}
              onChange={(e) => setRate(Number.parseInt(e.target.value, 10) || 60)}
              className="tabular-nums"
            />
          </Field>
          <Button type="submit" loading={create.pending} disabled={!name.trim()}>
            <Plus className="size-4" aria-hidden /> {t("create")}
          </Button>
        </form>
      </PageSection>

      <PageSection title={t("title")} description={t("count", { count: keys.length })}>
        <DataTable
          columns={columns}
          data={keys}
          dense
          searchable={keys.length > 5}
          getRowId={(k) => k.id}
          emptyState={<EmptyState compact icon={<Key />} title={t("empty")} description={t("emptyHint")} />}
          rowActions={(k) =>
            k.revokedAt ? null : (
              <Button size="icon" variant="ghost" onClick={() => void onRevoke(k)} disabled={revoke.pending} aria-label={t("revoke")}>
                <Trash2 className="size-4 text-danger" aria-hidden />
              </Button>
            )
          }
        />
      </PageSection>
    </div>
  );
}
