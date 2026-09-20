"use client";

import { LogViewer } from "@/components/ops/log-viewer";
import { Alert, Badge, Button, Checkbox, DataTable, EmptyState, Field, Input, PageSection, type ColumnDef } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ok, type ActionResult } from "@/lib/action-result";
import { rotateSshKeyAction, type RotateResult } from "@/server/actions/ssh-rotate";
import { KeyRound, RotateCw, Server } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";

interface KeyLite {
  id: string;
  name: string;
  algo: string;
  fingerprint: string | null;
}
interface VmLite {
  id: string;
  name: string;
  region: string;
  publicIp: string | null;
  accountLabel: string;
}

interface Props {
  keys: KeyLite[];
  instances: VmLite[];
}

export function KeyRotationView({ keys, instances }: Props) {
  const t = useTranslations("ops.keyRotation");
  const confirm = useConfirm();
  const [keyId, setKeyId] = useState(keys[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [user, setUser] = useState("root");
  const [last, setLast] = useState<RotateResult | null>(null);

  const eligible = useMemo(() => instances.filter((i) => i.publicIp), [instances]);
  const allSelected = eligible.length > 0 && eligible.every((i) => selected.has(i.id));
  const someSelected = eligible.some((i) => selected.has(i.id));

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });
  };
  const toggleAll = (on: boolean) => setSelected(on ? new Set(eligible.map((i) => i.id)) : new Set());

  const rotate = useAction(
    async (): Promise<ActionResult<RotateResult>> => {
      const res = await rotateSshKeyAction({ newKeyId: keyId, instanceIds: Array.from(selected), user });
      setLast(res);
      if (!res.ok && res.rotated.length === 0) {
        return { ok: false, error: t("rotateFailed", { failed: res.failed.length }) };
      }
      return ok(res);
    },
    { success: (res) => t("rotated", { ok: res.rotated.length, failed: res.failed.length }), refresh: false },
  );

  const selectedKey = keys.find((k) => k.id === keyId);
  const notice: ReactNode = t.rich("notice", { code: (chunks: ReactNode) => <code className="rounded bg-surface-muted px-1 font-mono">{chunks}</code> });

  async function onRotate() {
    if (!keyId || selected.size === 0) return;
    const yes = await confirm({
      title: t("confirmTitle", { count: selected.size }),
      description: t("confirmHint", { key: selectedKey?.name ?? keyId, user }),
      tone: "danger",
      confirmText: t("confirmButton"),
      requireText: t("confirmWord"),
    });
    if (yes) await rotate.run();
  }

  const nameById = useMemo(() => new Map(instances.map((i) => [i.id, i.name] as const)), [instances]);
  const logLines = last
    ? [
        t("log.summary", { ok: last.rotated.length, failed: last.failed.length }),
        ...last.rotated.map((id) => t("log.okLine", { name: nameById.get(id) ?? id })),
        ...last.failed.map((f) => t("log.failedLine", { name: nameById.get(f.instanceId) ?? f.instanceId, error: f.error })),
      ]
    : [];

  const columns = useMemo<ColumnDef<VmLite, unknown>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: () => (
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            onCheckedChange={toggleAll}
            disabled={eligible.length === 0}
            aria-label={t("selectAll")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selected.has(row.original.id)}
            onCheckedChange={(v) => toggle(row.original.id, v)}
            disabled={!row.original.publicIp}
            aria-label={t("selectOne", { name: row.original.name })}
          />
        ),
      },
      {
        accessorKey: "name",
        header: t("columns.name"),
        cell: ({ row }) => <span className="block max-w-[16rem] truncate font-medium">{row.original.name}</span>,
      },
      {
        accessorKey: "accountLabel",
        header: t("columns.account"),
        cell: ({ row }) => <span className="block max-w-[12rem] truncate text-xs text-fg-muted">{row.original.accountLabel}</span>,
      },
      {
        accessorKey: "region",
        header: t("columns.region"),
        cell: ({ row }) => <code className="whitespace-nowrap font-mono text-xs">{row.original.region}</code>,
      },
      {
        accessorKey: "publicIp",
        header: t("columns.ip"),
        cell: ({ row }) =>
          row.original.publicIp ? (
            <code className="font-mono text-xs">{row.original.publicIp}</code>
          ) : (
            <Badge variant="muted">{t("noPublicIp")}</Badge>
          ),
      },
      {
        id: "result",
        header: t("columns.result"),
        enableSorting: false,
        cell: ({ row }) => {
          if (!last) return <span className="text-xs text-fg-muted">—</span>;
          if (last.rotated.includes(row.original.id)) return <Badge variant="success">{t("resultOk")}</Badge>;
          const f = last.failed.find((x) => x.instanceId === row.original.id);
          if (f)
            return (
              <Badge variant="danger" title={f.error} className="max-w-[14rem] truncate">
                {f.error}
              </Badge>
            );
          return <span className="text-xs text-fg-muted">—</span>;
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggle/toggleAll are stable closures over setState
    [t, selected, allSelected, someSelected, eligible.length, last],
  );

  return (
    <div className="space-y-6">
      <PageSection title={t("setup.title")} description={t("setup.description")}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
          <Field label={t("setup.key")}>
            <Select value={keyId} onValueChange={setKeyId}>
              <SelectTrigger aria-label={t("setup.key")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {keys.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name} · {k.algo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("setup.user")}>
            <Input value={user} onChange={(e) => setUser(e.target.value)} className="font-mono" autoComplete="off" />
          </Field>
          <Button variant="danger" onClick={() => void onRotate()} loading={rotate.pending} disabled={!keyId || selected.size === 0}>
            <RotateCw className="size-4" aria-hidden /> {t("rotateOn", { count: selected.size })}
          </Button>
        </div>
        {selectedKey?.fingerprint && (
          <p className="mt-3 text-xs text-fg-muted">
            {t("setup.fingerprint")} <code className="font-mono">{selectedKey.fingerprint}</code>
          </p>
        )}
      </PageSection>

      <PageSection title={t("targets.title")} description={t("targets.description", { count: eligible.length, total: instances.length })}>
        <DataTable
          columns={columns}
          data={instances}
          dense
          searchable={instances.length > 5}
          getRowId={(i) => i.id}
          emptyState={<EmptyState compact icon={<Server />} title={t("targets.empty")} description={t("targets.emptyHint")} />}
        />
      </PageSection>

      {last && (
        <LogViewer
          title={t("log.title")}
          lines={logLines}
          height="max-h-72"
          wrap
          lineTone={(_line, i) => (i === 0 ? (last.failed.length ? "warning" : "success") : i <= last.rotated.length ? "success" : "danger")}
        />
      )}

      <Alert tone="info" icon={<KeyRound />}>
        {notice}
      </Alert>
    </div>
  );
}
