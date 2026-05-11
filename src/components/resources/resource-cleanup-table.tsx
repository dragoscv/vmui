"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { bulkDeleteResourcesAction } from "@/server/actions/bulk-resources";

interface CleanupRow {
  id: string;
  externalId: string;
  region: string;
  kind: string;
  name: string | null;
  sizeBytes: number | null;
  status: string | null;
  monthlyUsd: number | null;
}

export function ResourceCleanupTable({ rows }: { rows: CleanupRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedCount = selected.size;
  const totalSavings = rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + (r.monthlyUsd ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">
          {selectedCount} selected{totalSavings > 0 ? ` · ~$${totalSavings.toFixed(2)}/mo savings` : ""}
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || selectedCount === 0}
          onClick={async () => {
            const ok = await confirm({
              title: `Delete ${selectedCount} resource${selectedCount === 1 ? "" : "s"}?`,
              description: "Permanent. AWS volumes/snapshots/keypairs only. Attached volumes are skipped.",
              confirmText: "Delete",
            });
            if (!ok) return;
            startTransition(async () => {
              const r = await bulkDeleteResourcesAction({ resourceIds: [...selected] });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              if (r.failed.length > 0) {
                toast.warning(`${r.deleted} deleted, ${r.failed.length} failed.`);
              } else {
                toast.success(`Deleted ${r.deleted} resource${r.deleted === 1 ? "" : "s"}.`);
              }
              setSelected(new Set());
            });
          }}
        >
          <Trash2 className="h-3.5 w-3.5 text-[var(--color-danger)]" />
          Delete selected
        </Button>
      </div>

      <table className="w-full border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="w-10"></th>
            <th>Resource</th>
            <th>Region</th>
            <th>Status</th>
            <th>Size</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40"
            >
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  className="accent-[var(--color-primary)]"
                />
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="info">{r.kind}</Badge>
                  <span>{r.name ?? r.externalId}</span>
                </div>
                <div className="font-mono text-[11px] text-muted">{r.externalId}</div>
              </td>
              <td className="px-3 py-2 text-xs">{r.region}</td>
              <td className="px-3 py-2 text-xs text-muted">{r.status ?? "—"}</td>
              <td className="px-3 py-2 text-xs">
                {r.sizeBytes ? `${(r.sizeBytes / 1024 ** 3).toFixed(0)} GB` : "—"}
              </td>
              <td className="px-3 py-2 text-xs">
                {r.monthlyUsd ? `$${r.monthlyUsd.toFixed(2)}/mo` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
