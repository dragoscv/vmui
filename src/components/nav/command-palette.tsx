"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  Search,
  Server,
  KeyRound,
  Activity,
  Settings as SettingsIcon,
  Plus,
  RefreshCw,
  Sun,
  Moon,
  Plug,
  Play,
  Square,
  RotateCw,
  CornerDownLeft,
  Boxes,
  Tag as TagIcon,
  Cloud,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { instanceAction, syncAllAccounts } from "@/server/actions/instances";
import { listPaletteIndex, type PaletteIndex } from "@/server/actions/palette";
import type { InstanceRow } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type CommandItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
  run: () => void | Promise<void>;
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [, start] = useTransition();
  const [query, setQuery] = useState("");
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [resources, setResources] = useState<PaletteIndex["resources"]>([]);
  const [accounts, setAccounts] = useState<PaletteIndex["accounts"]>([]);
  const [tags, setTags] = useState<PaletteIndex["tags"]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Lazy-load fleet on first open
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    listPaletteIndex()
      .then((idx) => {
        setInstances(idx.instances);
        setResources(idx.resources);
        setAccounts(idx.accounts);
        setTags(idx.tags);
      })
      .catch(() => {
        setInstances([]);
        setResources([]);
        setAccounts([]);
        setTags([]);
      });
    // focus input after dialog mount
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  function close() {
    onOpenChange(false);
  }

  const items = useMemo<CommandItem[]>(() => {
    const navItems: CommandItem[] = [
      {
        id: "nav:dashboard",
        group: "Navigate",
        label: "Dashboard",
        icon: Server,
        run: () => router.push("/"),
      },
      {
        id: "nav:accounts",
        group: "Navigate",
        label: "Accounts",
        icon: KeyRound,
        run: () => router.push("/accounts"),
      },
      {
        id: "nav:activity",
        group: "Navigate",
        label: "Activity log",
        icon: Activity,
        run: () => router.push("/activity"),
      },
      {
        id: "nav:settings",
        group: "Navigate",
        label: "Settings",
        icon: SettingsIcon,
        run: () => router.push("/settings"),
      },
    ];

    const actionItems: CommandItem[] = [
      {
        id: "action:new",
        group: "Actions",
        label: "Launch new instance",
        hint: "N",
        icon: Plus,
        run: () => router.push("/instances/new"),
      },
      {
        id: "action:sync",
        group: "Actions",
        label: "Sync all accounts",
        hint: "R",
        icon: RefreshCw,
        run: () => {
          start(async () => {
            try {
              const r = await syncAllAccounts();
              toast.success(`Synced ${r.accounts} account(s) — ${r.instances} instance(s)`);
              router.refresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Sync failed");
            }
          });
        },
      },
      {
        id: "action:theme",
        group: "Actions",
        label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        hint: "T",
        icon: resolvedTheme === "dark" ? Sun : Moon,
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
    ];

    const vmItems: CommandItem[] = instances.flatMap((i) => {
      const label = i.displayName ?? i.name ?? i.providerInstanceId;
      const out: CommandItem[] = [
        {
          id: `vm:open:${i.id}`,
          group: "Instances",
          label: `Open ${label}`,
          hint: i.provider,
          icon: Server,
          keywords: `${i.providerInstanceId} ${i.region} ${i.publicIp ?? ""} ${i.notes ?? ""}`,
          run: () => router.push(`/instances/${encodeURIComponent(i.id)}`),
        },
      ];
      if (i.state === "running") {
        out.push({
          id: `vm:connect:${i.id}`,
          group: "Instances",
          label: `Connect to ${label}`,
          icon: Plug,
          run: () => router.push(`/instances/${encodeURIComponent(i.id)}`),
        });
        out.push({
          id: `vm:stop:${i.id}`,
          group: "Instances",
          label: `Stop ${label}`,
          icon: Square,
          run: () =>
            start(async () => {
              const r = await instanceAction("stop", {
                accountId: i.accountId,
                region: i.region,
                providerInstanceId: i.providerInstanceId,
              });
              if (r.ok) toast.success(`stop requested`);
              else toast.error(r.error ?? "Failed");
              router.refresh();
            }),
        });
        out.push({
          id: `vm:reboot:${i.id}`,
          group: "Instances",
          label: `Reboot ${label}`,
          icon: RotateCw,
          run: () =>
            start(async () => {
              const r = await instanceAction("reboot", {
                accountId: i.accountId,
                region: i.region,
                providerInstanceId: i.providerInstanceId,
              });
              if (r.ok) toast.success(`reboot requested`);
              else toast.error(r.error ?? "Failed");
              router.refresh();
            }),
        });
      } else if (i.state === "stopped") {
        out.push({
          id: `vm:start:${i.id}`,
          group: "Instances",
          label: `Start ${label}`,
          icon: Play,
          run: () =>
            start(async () => {
              const r = await instanceAction("start", {
                accountId: i.accountId,
                region: i.region,
                providerInstanceId: i.providerInstanceId,
              });
              if (r.ok) toast.success(`start requested`);
              else toast.error(r.error ?? "Failed");
              router.refresh();
            }),
        });
      }
      return out;
    });

    const accountItems: CommandItem[] = accounts.map((a) => ({
      id: `account:${a.id}`,
      group: "Accounts",
      label: `${a.name}`,
      hint: a.provider,
      icon: Cloud,
      keywords: `${a.provider} ${a.defaultRegion ?? ""}`,
      run: () => router.push(`/accounts/${encodeURIComponent(a.id)}`),
    }));

    const resourceItems: CommandItem[] = resources.slice(0, 200).map((r) => ({
      id: `res:${r.id}`,
      group: "Resources",
      label: r.name ?? r.externalId,
      hint: `${r.kind} · ${r.region}`,
      icon: Boxes,
      keywords: `${r.provider} ${r.kind} ${r.externalId} ${r.region}`,
      run: () => router.push(`/resources?kind=${encodeURIComponent(r.kind)}&q=${encodeURIComponent(r.externalId)}`),
    }));

    const seenTagPairs = new Set<string>();
    const tagItems: CommandItem[] = [];
    for (const t of tags) {
      const k = `${t.key}=${t.value}`;
      if (seenTagPairs.has(k)) continue;
      seenTagPairs.add(k);
      tagItems.push({
        id: `tag:${k}`,
        group: "Tags",
        label: t.value ? `${t.key}: ${t.value}` : t.key,
        icon: TagIcon,
        keywords: `${t.key} ${t.value}`,
        run: () => router.push(`/tags?key=${encodeURIComponent(t.key)}${t.value ? `&value=${encodeURIComponent(t.value)}` : ""}`),
      });
    }

    return [...navItems, ...actionItems, ...vmItems, ...accountItems, ...resourceItems, ...tagItems];
  }, [instances, resources, accounts, tags, resolvedTheme, router, setTheme]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = `${it.label} ${it.group} ${it.hint ?? ""} ${it.keywords ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  // Reset active on filter change
  useEffect(() => setActive(0), [query]);

  // Scroll active into view
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-cmd-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const grouped = useMemo(() => {
    const map = new Map<string, { idx: number; item: CommandItem }[]>();
    filtered.forEach((it, i) => {
      const arr = map.get(it.group) ?? [];
      arr.push({ idx: i, item: it });
      map.set(it.group, arr);
    });
    return [...map.entries()];
  }, [filtered]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = filtered[active];
      if (sel) {
        sel.run();
        close();
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <Search className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command, instance, or page…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-fg-muted)]"
          />
          <kbd className="hidden rounded border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">No matches.</div>
          ) : (
            grouped.map(([group, list]) => (
              <div key={group} className="mb-1.5">
                <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {group}
                </div>
                {list.map(({ idx, item }) => {
                  const Icon = item.icon;
                  const isActive = idx === active;
                  return (
                    <button
                      key={item.id}
                      data-cmd-idx={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => {
                        item.run();
                        close();
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm transition-colors",
                        isActive
                          ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-[var(--color-fg)]"
                          : "text-muted hover:bg-[color-mix(in_oklch,var(--color-fg)_5%,transparent)] hover:text-[var(--color-fg)]",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-[var(--color-primary)]")} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint && (
                        <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-1.5 py-0.5 font-mono text-[10px]">
                          {item.hint}
                        </kbd>
                      )}
                      {isActive && <CornerDownLeft className="h-3.5 w-3.5 text-[var(--color-primary)]" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-[11px] text-muted">
          <span>↑↓ navigate · ↵ run · esc close</span>
          <span>{filtered.length} item{filtered.length === 1 ? "" : "s"}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
