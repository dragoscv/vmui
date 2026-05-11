"use client";

import { useState } from "react";
import {
  HardDrive,
  Camera,
  Shield,
  Key,
  Network,
  Boxes,
  Database,
  Cloud,
  Globe,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CachedResourceRow } from "@/lib/db/schema";
import { formatUsd } from "@/lib/utils";
import { ResourceDetailDrawer } from "./resource-detail-drawer";

const KIND_LABEL: Record<string, { label: string; icon: LucideIcon }> = {
  volume: { label: "Volumes", icon: HardDrive },
  snapshot: { label: "Snapshots", icon: Camera },
  "security-group": { label: "Security groups", icon: Shield },
  keypair: { label: "Key pairs", icon: Key },
  vpc: { label: "VPCs", icon: Network },
  subnet: { label: "Subnets", icon: Boxes },
  bucket: { label: "Buckets", icon: Cloud },
  database: { label: "Databases", icon: Database },
  "load-balancer": { label: "Load balancers", icon: Zap },
  "dns-zone": { label: "DNS zones", icon: Globe },
};

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function ResourcesExplorer({ byKind }: { byKind: Record<string, CachedResourceRow[]> }) {
  const kinds = Object.keys(byKind).sort();
  const [active, setActive] = useState<string>(kinds[0] ?? "volume");
  const rows = byKind[active] ?? [];
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<CachedResourceRow | null>(null);
  const filtered = filter
    ? rows.filter(
        (r) =>
          (r.name ?? "").toLowerCase().includes(filter.toLowerCase()) ||
          r.externalId.toLowerCase().includes(filter.toLowerCase()) ||
          (r.region ?? "").toLowerCase().includes(filter.toLowerCase()),
      )
    : rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {kinds.map((k) => {
          const meta = KIND_LABEL[k] ?? { label: k, icon: Boxes };
          const Icon = meta.icon;
          const count = byKind[k]?.length ?? 0;
          const isActive = k === active;
          return (
            <button
              key={k}
              onClick={() => {
                setActive(k);
                setFilter("");
              }}
              className={`flex items-center gap-2 rounded-[var(--radius-md)] border px-3 py-1.5 text-xs transition-colors ${
                isActive
                  ? "border-[var(--color-primary)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)] text-[var(--color-fg)]"
                  : "border-[var(--color-border)] text-muted hover:bg-[var(--color-bg-muted)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="font-medium">{meta.label}</span>
              <Badge variant={isActive ? "info" : "muted"}>{count}</Badge>
            </button>
          );
        })}
      </div>

      <input
        type="search"
        placeholder={`Filter ${KIND_LABEL[active]?.label.toLowerCase() ?? "resources"}…`}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-bg-muted)] text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Region</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Size</th>
                <th className="px-3 py-2 text-left">Linked</th>
                <th className="px-3 py-2 text-left">$/mo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-xs text-muted">
                    No matches.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-[var(--color-border)] hover:bg-[var(--color-bg-muted)]/40"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-3 py-2 font-medium">{r.name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{r.externalId}</td>
                    <td className="px-3 py-2 text-xs">{r.region}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.status ? <Badge variant="muted">{r.status}</Badge> : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{formatBytes(r.sizeBytes)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted">
                      {r.attachedToInstanceId ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.monthlyUsd ? formatUsd(r.monthlyUsd) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ResourceDetailDrawer resource={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
