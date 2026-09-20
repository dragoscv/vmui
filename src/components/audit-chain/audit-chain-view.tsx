"use client";

import { Alert, Button, DataTable, EmptyState, PageSection, Stat, StatGrid, sortableHeader, type ColumnDef } from "@/components/ui";
import { useAction } from "@/hooks/use-action";
import type { VerifyResult } from "@/lib/audit-chain";
import { verifyAuditChainAction } from "@/server/actions/audit-chain";
import { Link2, ShieldCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import * as React from "react";

export interface ChainSegment {
  id: number;
  fromAuditId: number;
  toAuditId: number;
  hash: string;
  hmac: string;
  computedAt: Date;
}

export function AuditChainView({ verify, segments }: { verify: VerifyResult; segments: ChainSegment[] }) {
  const t = useTranslations("govern.auditChain");
  const format = useFormatter();
  const [result, setResult] = React.useState(verify);

  const run = useAction(verifyAuditChainAction, {
    success: (r) => (r.ok ? t("toast.verified") : t("toast.invalid")),
    onSuccess: setResult,
  });

  const covered = segments.reduce((a, s) => a + (s.toAuditId - s.fromAuditId + 1), 0);
  const latest = segments[0];

  const columns = React.useMemo<ColumnDef<ChainSegment, unknown>[]>(
    () => [
      { accessorKey: "id", header: sortableHeader(t("columns.segment")), cell: ({ row }) => <span className="tabular-nums">{row.original.id}</span> },
      {
        id: "range",
        accessorFn: (s) => s.fromAuditId,
        header: sortableHeader(t("columns.range")),
        cell: ({ row }) => (
          <span className="tabular-nums text-fg-muted">
            {row.original.fromAuditId}–{row.original.toAuditId}
          </span>
        ),
      },
      { accessorKey: "hash", header: t("columns.hash"), enableSorting: false, cell: ({ row }) => <Hash value={row.original.hash} /> },
      { accessorKey: "hmac", header: t("columns.hmac"), enableSorting: false, cell: ({ row }) => <Hash value={row.original.hmac} /> },
      {
        accessorKey: "computedAt",
        header: sortableHeader(t("columns.when")),
        cell: ({ row }) => <span className="whitespace-nowrap text-fg-muted">{format.dateTime(new Date(row.original.computedAt), { dateStyle: "medium", timeStyle: "short" })}</span>,
      },
    ],
    [t, format],
  );

  return (
    <div className="space-y-4">
      <Alert
        tone={result.ok ? "success" : "danger"}
        title={result.ok ? t("verified.title") : t("invalid.title")}
        action={
          <Button size="sm" variant="secondary" loading={run.pending} onClick={() => void run.run()}>
            <ShieldCheck className="size-4" aria-hidden /> {t("verify")}
          </Button>
        }
      >
        {result.ok ? t("verified.description", { count: result.segments }) : t("invalid.description", { segment: result.firstBadSegmentId ?? "?", reason: result.reason ?? "" })}
      </Alert>

      <StatGrid cols={3}>
        <Stat label={t("stats.segments")} value={segments.length} icon={<Link2 />} />
        <Stat label={t("stats.covered")} value={covered} />
        <Stat label={t("stats.latest")} value={latest ? format.dateTime(new Date(latest.computedAt), { dateStyle: "medium", timeStyle: "short" }) : "—"} className="[&>div:nth-child(2)]:text-base" />
      </StatGrid>

      <PageSection title={t("columns.segment")}>
        <DataTable
          columns={columns}
          data={segments}
          dense
          getRowId={(s) => String(s.id)}
          emptyState={<EmptyState compact icon={<Link2 />} title={t("empty.title")} description={t("empty.description")} />}
        />
      </PageSection>
    </div>
  );
}

function Hash({ value }: { value: string }) {
  return (
    <code title={value} className="block max-w-[10rem] truncate font-mono text-xs text-fg-muted sm:max-w-[14rem]">
      {value}
    </code>
  );
}
