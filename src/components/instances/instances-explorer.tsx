"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Search,
  X,
  LayoutGrid,
  List as ListIcon,
  Filter,
  ArrowUpDown,
  Download,
  Play,
  Square,
  RotateCw,
  Pin,
  Bookmark,
  BookmarkPlus,
  Trash2,
  Loader2,
  Camera,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InstanceCard } from "./instance-card";
import { InstanceListRow } from "./instance-list-row";
import { instanceLabel } from "./instance-label";
import { bulkInstanceAction } from "@/server/actions/instances";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { InstanceRow } from "@/lib/db/schema";
import type { PricedRow } from "@/lib/pricing";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "list";
type SortKey = "manual" | "name" | "state" | "provider" | "lastSynced" | "created";
type SortDir = "asc" | "desc";

const VIEW_KEY = "vmui:instances:view";
const SORT_KEY = "vmui:instances:sort";
const FILTER_KEY = "vmui:instances:filters";
const SAVED_KEY = "vmui:instances:saved";

interface SavedSearch {
  name: string;
  query: string;
  state: string[];
  platform: string[];
  provider: string[];
}

const STATE_FILTERS: { id: string; label: string }[] = [
  { id: "running", label: "Running" },
  { id: "pending", label: "Pending" },
  { id: "stopping", label: "Stopping" },
  { id: "stopped", label: "Stopped" },
  { id: "shutting-down", label: "Shutting down" },
  { id: "terminated", label: "Terminated" },
  { id: "unknown", label: "Unknown" },
];

const PLATFORM_FILTERS: { id: string; label: string }[] = [
  { id: "linux", label: "Linux" },
  { id: "windows", label: "Windows" },
  { id: "macos", label: "macOS" },
];

export function InstancesExplorer({
  instances,
  providers,
  priceMap,
}: {
  instances: InstanceRow[];
  providers: string[];
  priceMap?: Record<string, PricedRow>;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set());
  const [platformFilter, setPlatformFilter] = useState<Set<string>>(new Set());
  const [providerFilter, setProviderFilter] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  // Hydrate persisted UI prefs
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "list") setView(v);
      const s = localStorage.getItem(SORT_KEY);
      if (s) {
        const parsed = JSON.parse(s) as { key: SortKey; dir: SortDir };
        if (parsed.key) setSortKey(parsed.key);
        if (parsed.dir) setSortDir(parsed.dir);
      }
      const f = localStorage.getItem(FILTER_KEY);
      if (f) {
        const parsed = JSON.parse(f) as {
          state?: string[];
          platform?: string[];
          provider?: string[];
        };
        if (parsed.state) setStateFilter(new Set(parsed.state));
        if (parsed.platform) setPlatformFilter(new Set(parsed.platform));
        if (parsed.provider) setProviderFilter(new Set(parsed.provider));
      }
      const saved = localStorage.getItem(SAVED_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as SavedSearch[];
        if (Array.isArray(parsed)) setSavedSearches(parsed);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* ignore */
    }
  }, [view]);
  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify({ key: sortKey, dir: sortDir }));
    } catch {
      /* ignore */
    }
  }, [sortKey, sortDir]);
  useEffect(() => {
    try {
      localStorage.setItem(
        FILTER_KEY,
        JSON.stringify({
          state: [...stateFilter],
          platform: [...platformFilter],
          provider: [...providerFilter],
        }),
      );
    } catch {
      /* ignore */
    }
  }, [stateFilter, platformFilter, providerFilter]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return instances.filter((i) => {
      if (stateFilter.size && !stateFilter.has(i.state)) return false;
      if (platformFilter.size && !platformFilter.has(i.platform)) return false;
      if (providerFilter.size && !providerFilter.has(i.provider)) return false;
      if (!q) return true;
      const hay = [
        instanceLabel(i),
        i.name,
        i.providerInstanceId,
        i.publicIp,
        i.privateIp,
        i.publicDns,
        i.region,
        i.provider,
        i.instanceType,
        i.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [instances, query, stateFilter, platformFilter, providerFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: InstanceRow, b: InstanceRow) => {
      // Pinned always first regardless of sort.
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      switch (sortKey) {
        case "manual": {
          const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
          const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
          if (ao !== bo) return (ao - bo) * dir;
          // Fallback: last-synced desc.
          return (
            (b.lastSyncedAt?.getTime() ?? 0) - (a.lastSyncedAt?.getTime() ?? 0)
          );
        }
        case "name":
          return instanceLabel(a).localeCompare(instanceLabel(b)) * dir;
        case "state":
          return a.state.localeCompare(b.state) * dir;
        case "provider":
          return a.provider.localeCompare(b.provider) * dir;
        case "lastSynced":
          return (
            ((a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0)) * dir
          );
        case "created":
          return (
            ((a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0)) * dir
          );
      }
    };
    return arr.sort(cmp);
  }, [filtered, sortKey, sortDir]);

  const filterCount =
    stateFilter.size + platformFilter.size + providerFilter.size + (query ? 1 : 0);

  function clearFilters() {
    setQuery("");
    setStateFilter(new Set());
    setPlatformFilter(new Set());
    setProviderFilter(new Set());
  }

  function exportCsv() {
    if (sorted.length === 0) return;
    const header = [
      "name",
      "providerInstanceId",
      "provider",
      "region",
      "state",
      "platform",
      "instanceType",
      "publicIp",
      "privateIp",
      "createdAt",
      "lastSyncedAt",
      "usdPerHour",
      "usdPerMonth",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const i of sorted) {
      const price = priceMap?.[i.id]?.usdPerHour ?? null;
      lines.push(
        [
          instanceLabel(i),
          i.providerInstanceId,
          i.provider,
          i.region,
          i.state,
          i.platform,
          i.instanceType ?? "",
          i.publicIp ?? "",
          i.privateIp ?? "",
          i.createdAt?.toISOString() ?? "",
          i.lastSyncedAt?.toISOString() ?? "",
          price ?? "",
          price != null ? (price * 730).toFixed(2) : "",
        ]
          .map(escape)
          .join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vmui-instances-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${sorted.length} row${sorted.length === 1 ? "" : "s"}`);
  }

  function persistSaved(next: SavedSearch[]) {
    setSavedSearches(next);
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function saveCurrentSearch() {
    const name = window.prompt("Name this filter set")?.trim();
    if (!name) return;
    const entry: SavedSearch = {
      name,
      query,
      state: [...stateFilter],
      platform: [...platformFilter],
      provider: [...providerFilter],
    };
    const next = [...savedSearches.filter((s) => s.name !== name), entry];
    persistSaved(next);
    toast.success(`Saved "${name}"`);
  }

  function applySaved(s: SavedSearch) {
    setQuery(s.query);
    setStateFilter(new Set(s.state));
    setPlatformFilter(new Set(s.platform));
    setProviderFilter(new Set(s.provider));
  }

  function deleteSaved(name: string) {
    persistSaved(savedSearches.filter((s) => s.name !== name));
  }

  function toggleSelect(id: string, additive: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (!additive && !prev.has(id) && prev.size > 0) {
        // single-click while selection active toggles only this one
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(sorted.map((i) => i.id)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function bulk(action: "start" | "stop" | "reboot" | "terminate" | "snapshot") {
    const ids = [...selected];
    if (ids.length === 0) return;
    const verb =
      action === "start"
        ? "Start"
        : action === "stop"
          ? "Stop"
          : action === "reboot"
            ? "Reboot"
            : action === "snapshot"
              ? "Snapshot"
              : "Terminate";
    const ok = await confirm({
      title: `${verb} ${ids.length} instance${ids.length === 1 ? "" : "s"}?`,
      description:
        action === "terminate"
          ? `This will permanently terminate ${ids.length} VM${ids.length === 1 ? "" : "s"}. Stopped EBS volumes may be deleted depending on provider settings.`
          : action === "snapshot"
            ? `Create a snapshot of ${ids.length} VM${ids.length === 1 ? "" : "s"}. Provider charges per snapshot apply.`
            : `This will ${action} ${ids.length} VM${ids.length === 1 ? "" : "s"} across selected accounts.`,
      tone: action === "terminate" ? "danger" : action === "stop" ? "warning" : "info",
      confirmText: verb,
    });
    if (!ok) return;
    start(async () => {
      const r = await bulkInstanceAction({ ids, action });
      if (r.failed === 0) toast.success(`${verb} requested for ${r.succeeded}`);
      else toast.error(`${r.succeeded} ok, ${r.failed} failed`);
      clearSelection();
      router.refresh();
    });
  }

  // Keyboard: '/' focuses search, Esc clears
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        document.getElementById("vmui-search")?.focus();
      } else if (e.key === "Escape" && selected.size > 0) {
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size]);

  const selectionActive = selected.size > 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="surface flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-fg-muted)]" />
          <Input
            id="vmui-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, IP, region, type, notes…  ( / )"
            className="border-transparent bg-transparent pl-8 shadow-none focus-visible:border-[color-mix(in_oklch,var(--color-primary)_55%,var(--color-border))]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted hover:bg-[color-mix(in_oklch,var(--color-fg)_8%,transparent)]"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filters */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <Filter className="h-3.5 w-3.5" /> Filter
                {filterCount > 0 && (
                  <span className="ml-1 rounded-full bg-[var(--color-primary)] px-1.5 text-[10px] font-semibold text-[var(--color-primary-fg)]">
                    {filterCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>State</DropdownMenuLabel>
              {STATE_FILTERS.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s.id}
                  checked={stateFilter.has(s.id)}
                  onCheckedChange={(v) => {
                    setStateFilter((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    });
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  {s.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Platform</DropdownMenuLabel>
              {PLATFORM_FILTERS.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p.id}
                  checked={platformFilter.has(p.id)}
                  onCheckedChange={(v) => {
                    setPlatformFilter((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(p.id);
                      else next.delete(p.id);
                      return next;
                    });
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  {p.label}
                </DropdownMenuCheckboxItem>
              ))}
              {providers.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Provider</DropdownMenuLabel>
                  {providers.map((p) => (
                    <DropdownMenuCheckboxItem
                      key={p}
                      checked={providerFilter.has(p)}
                      onCheckedChange={(v) => {
                        setProviderFilter((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(p);
                          else next.delete(p);
                          return next;
                        });
                      }}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {p}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}
              {filterCount > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="block w-full px-2.5 py-1.5 text-left text-sm text-[var(--color-danger)] hover:bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)]"
                  >
                    Clear all filters
                  </button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort */}
          <div className="flex items-center gap-1">
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual order</SelectItem>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="state">State</SelectItem>
                <SelectItem value="provider">Provider</SelectItem>
                <SelectItem value="lastSynced">Last synced</SelectItem>
                <SelectItem value="created">Created</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={sortDir === "asc" ? "Ascending" : "Descending"}
              aria-label="Toggle sort direction"
            >
              <ArrowUpDown
                className={cn("h-3.5 w-3.5 transition-transform", sortDir === "desc" && "rotate-180")}
              />
            </Button>
          </div>

          {/* View toggle */}
          <div className="flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "rounded-[calc(var(--radius-md)-2px)] p-1.5 transition-colors",
                view === "grid"
                  ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-[var(--color-primary)]"
                  : "text-muted hover:text-[var(--color-fg)]",
              )}
              aria-label="Grid view"
              aria-pressed={view === "grid"}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={cn(
                "rounded-[calc(var(--radius-md)-2px)] p-1.5 transition-colors",
                view === "list"
                  ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-[var(--color-primary)]"
                  : "text-muted hover:text-[var(--color-fg)]",
              )}
              aria-label="List view"
              aria-pressed={view === "list"}
            >
              <ListIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={exportCsv}
            disabled={sorted.length === 0}
            title="Download visible instances as CSV"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" title="Saved filter sets">
                <Bookmark className="h-3.5 w-3.5" />
                {savedSearches.length > 0 && (
                  <span className="text-[10px] text-muted">{savedSearches.length}</span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>Saved searches</DropdownMenuLabel>
              {savedSearches.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted">No saved searches yet.</div>
              )}
              {savedSearches.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center gap-1 px-2 py-1 text-xs hover:bg-white/5"
                >
                  <button
                    type="button"
                    onClick={() => applySaved(s)}
                    className="flex-1 truncate text-left"
                    title={`Apply "${s.name}"`}
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSaved(s.name)}
                    className="p-1 text-muted hover:text-[var(--color-danger)]"
                    aria-label={`Delete ${s.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <DropdownMenuSeparator />
              <button
                type="button"
                onClick={saveCurrentSearch}
                disabled={filterCount === 0}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
              >
                <BookmarkPlus className="h-3.5 w-3.5" /> Save current
              </button>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Active filter chips */}
      {filterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Filters:</span>
          {[...stateFilter].map((s) => (
            <FilterChip key={`s-${s}`} label={s} onRemove={() => {
              setStateFilter((p) => { const n = new Set(p); n.delete(s); return n; });
            }} />
          ))}
          {[...platformFilter].map((p) => (
            <FilterChip key={`p-${p}`} label={p} onRemove={() => {
              setPlatformFilter((prev) => { const n = new Set(prev); n.delete(p); return n; });
            }} />
          ))}
          {[...providerFilter].map((p) => (
            <FilterChip key={`pr-${p}`} label={p} onRemove={() => {
              setProviderFilter((prev) => { const n = new Set(prev); n.delete(p); return n; });
            }} />
          ))}
          {query && (
            <FilterChip label={`"${query}"`} onRemove={() => setQuery("")} />
          )}
          <button
            type="button"
            onClick={clearFilters}
            className="text-[var(--color-danger)] hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectionActive && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]/90 p-2 shadow-lg backdrop-blur-md"
          >
            <Badge variant="info">{selected.size} selected</Badge>
            <Button size="sm" variant="ghost" onClick={selectAll}>
              Select all ({sorted.length})
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
            <div className="ml-auto flex flex-wrap gap-1">
              <Button size="sm" variant="secondary" onClick={() => bulk("start")} disabled={pending}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Start
              </Button>
              <Button size="sm" variant="secondary" onClick={() => bulk("stop")} disabled={pending}>
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
              <Button size="sm" variant="secondary" onClick={() => bulk("reboot")} disabled={pending}>
                <RotateCw className="h-3.5 w-3.5" /> Reboot
              </Button>
              <Button size="sm" variant="secondary" onClick={() => bulk("snapshot")} disabled={pending}>
                <Camera className="h-3.5 w-3.5" /> Snapshot
              </Button>
              <Button size="sm" variant="danger" onClick={() => bulk("terminate")} disabled={pending}>
                <Trash2 className="h-3.5 w-3.5" /> Terminate
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result count + empty filtered */}
      {filterCount > 0 && (
        <div className="text-xs text-muted">
          Showing {sorted.length} of {instances.length}
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyResult onClear={filterCount > 0 ? clearFilters : undefined} />
      ) : view === "grid" ? (
        <motion.div layout className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false} mode="popLayout">
            {sorted.map((i, idx) => (
              <InstanceCard
                key={i.id}
                instance={i}
                index={idx}
                selected={selected.has(i.id)}
                onToggleSelect={toggleSelect}
                selectionActive={selectionActive}
                price={priceMap?.[i.id]}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      ) : (
        <motion.div layout className="flex flex-col gap-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {sorted.map((i, idx) => (
              <InstanceListRow
                key={i.id}
                instance={i}
                index={idx}
                selected={selected.has(i.id)}
                onToggleSelect={toggleSelect}
                selectionActive={selectionActive}
                price={priceMap?.[i.id]}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Pinned hint */}
      {instances.some((i) => i.pinned) && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <Pin className="h-3 w-3" /> Pinned instances always appear first.
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)] px-2 py-0.5 text-[var(--color-primary)]">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full hover:bg-[color-mix(in_oklch,var(--color-primary)_25%,transparent)]"
        aria-label={`Remove filter ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function EmptyResult({ onClear }: { onClear?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="surface flex flex-col items-center gap-2 py-12 text-center"
    >
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-bg-muted)]">
        <Search className="h-5 w-5 text-muted" />
      </div>
      <div className="text-sm font-medium">No instances match your filters</div>
      <div className="text-xs text-muted">Try removing a filter or clearing your search.</div>
      {onClear && (
        <Button size="sm" variant="secondary" onClick={onClear} className="mt-2">
          Clear filters
        </Button>
      )}
    </motion.div>
  );
}
