"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Trash2, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { bulkApplyTags } from "@/server/actions/bulk-tags";

interface Row {
  id: string;
  name: string | null;
  displayName: string | null;
  provider: string;
  region: string;
  state: string;
  instanceType: string | null;
}

export function BulkTagPanel({ rows }: { rows: Row[] }) {
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [pending, start] = useTransition();

  const providers = useMemo(() => Array.from(new Set(rows.map((r) => r.provider))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    return rows.filter((r) => {
      if (providerFilter !== "all" && r.provider !== providerFilter) return false;
      if (!q) return true;
      return (
        (r.displayName ?? r.name ?? "").toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.region.toLowerCase().includes(q) ||
        (r.instanceType ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, filter, providerFilter]);

  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = () => {
    const tagMap: Record<string, string> = {};
    for (const t of tags) {
      const k = t.key.trim();
      if (!k) continue;
      tagMap[k] = t.value.trim();
    }
    if (Object.keys(tagMap).length === 0) {
      toast.error("Add at least one tag key");
      return;
    }
    if (selected.size === 0) {
      toast.error("Select at least one VM");
      return;
    }
    if (!confirm(`Apply ${Object.keys(tagMap).length} tag(s) to ${selected.size} VM(s)?`)) return;
    start(async () => {
      const res = await bulkApplyTags({ instanceIds: Array.from(selected), tags: tagMap });
      if (res.failed.length === 0) toast.success(`Tagged ${res.ok} VM(s)`);
      else toast.error(`${res.ok} ok, ${res.failed.length} failed: ${res.failed[0]?.error ?? ""}`);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Tag className="h-6 w-6 text-[var(--color-primary)]" />
            Bulk tagging
          </h1>
          <p className="text-sm text-muted">
            Apply the same tag set to many VMs at once. AWS, Azure, and GCP supported.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Choose tags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tags.map((t, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                placeholder="key (e.g. owner)"
                value={t.key}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setTags((prev) => prev.map((p, i) => (i === idx ? { ...p, key: v } : p)));
                }}
                className="max-w-xs"
              />
              <Input
                placeholder="value"
                value={t.value}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setTags((prev) => prev.map((p, i) => (i === idx ? { ...p, value: v } : p)));
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTags((prev) => prev.filter((_, i) => i !== idx))}
                disabled={tags.length === 1}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTags((prev) => [...prev, { key: "", value: "" }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add tag
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2 · Pick targets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Filter by name, region, type…"
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              className="max-w-sm"
            />
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.currentTarget.value as string | "all")}
              className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              <option value="all">All providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <Badge variant="info">{selected.size} selected</Badge>
          </div>
          <div className="overflow-x-auto rounded border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-bg-muted)] text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Provider</th>
                  <th className="px-3 py-2 text-left">Region</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted">
                      No VMs match.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-t border-[var(--color-border)] hover:bg-[var(--color-bg-muted)]/40"
                      onClick={() => toggle(r.id)}
                    >
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selected.has(r.id)} readOnly />
                      </td>
                      <td className="px-3 py-2 font-medium">{r.displayName ?? r.name ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.provider}</td>
                      <td className="px-3 py-2 text-xs">{r.region}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.instanceType ?? "—"}</td>
                      <td className="px-3 py-2 text-xs">{r.state}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={apply} disabled={pending || selected.size === 0}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
          Apply tags to {selected.size} VM{selected.size === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}
