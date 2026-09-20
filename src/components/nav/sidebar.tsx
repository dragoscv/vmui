"use client";

import { cn } from "@/lib/utils";
import { ChevronDown, Cloud } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { isNavActive, NAV_GROUPS, NAV_PRIMARY, NAV_SETTINGS, type NavGroup, type NavItem } from "./nav-model";

const STORAGE_KEY = "vmui.sidebar.open";
const DEFAULT_OPEN: Record<NavGroup["id"], boolean> = { cloud: true, ops: true, observe: true, govern: false, more: false };

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const t = useTranslations("shell.items");
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] font-medium text-[var(--color-fg)]"
          : "text-muted hover:bg-[color-mix(in_oklch,var(--color-fg)_6%,transparent)] hover:text-[var(--color-fg)]",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-[var(--color-primary)]")} aria-hidden />
      <span className="truncate">{t(item.id as Parameters<typeof t>[0])}</span>
    </Link>
  );
}

export function Sidebar({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const [open, setOpen] = React.useState<Record<NavGroup["id"], boolean>>(DEFAULT_OPEN);
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setOpen((o) => ({ ...o, ...(JSON.parse(raw) as Partial<typeof o>) }));
    } catch {
      /* corrupt or blocked storage: keep defaults */
    }
  }, []);
  const toggle = (id: NavGroup["id"]) =>
    setOpen((o) => {
      const next = { ...o, [id]: !o[id] };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });

  return (
    <aside data-vmui-sidebar className="hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-surface)_50%,transparent)] backdrop-blur-md md:sticky md:top-0 md:flex">
      <Link href="/home" className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <div className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-[var(--shadow-glow)]">
          <Cloud className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 leading-tight">
          <div className="text-base font-semibold">vmui</div>
          <div className="truncate text-xs text-muted">{t("brand.tagline")}</div>
        </div>
      </Link>

      <nav aria-label={t("sidebar.label")} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
        <div className="flex flex-col gap-0.5">
          {(compact ? NAV_PRIMARY.filter((it) => it.id === "home") : NAV_PRIMARY).map((it) => (
            <NavLink key={it.href} item={it} active={isNavActive(pathname, it)} />
          ))}
        </div>
        {!compact && NAV_GROUPS.map((g) => {
          const hasActive = g.items.some((it) => isNavActive(pathname, it));
          const expanded = open[g.id] || hasActive;
          const bodyId = `nav-group-${g.id}`;
          return (
            <div key={g.id} className="mt-3">
              <button
                type="button"
                onClick={() => toggle(g.id)}
                aria-expanded={expanded}
                aria-controls={bodyId}
                aria-label={t("sidebar.toggleGroup", { group: t(`groups.${g.id}`) })}
                className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted transition-colors hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <span className="truncate">{t(`groups.${g.id}`)}</span>
                <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden />
              </button>
              <div id={bodyId} hidden={!expanded} className="mt-0.5 flex flex-col gap-0.5">
                {g.items.map((it) => (
                  <NavLink key={it.href} item={it} active={isNavActive(pathname, it)} />
                ))}
              </div>
            </div>
          );
        })}
        {!compact && <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <NavLink item={NAV_SETTINGS} active={isNavActive(pathname, NAV_SETTINGS)} />
        </div>}
      </nav>

      <div className="space-y-2 border-t border-[var(--color-border)] p-4 text-xs text-muted">
        <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-2 py-1.5">
          <span className="truncate">{t("brand.commandPalette")}</span>
          <kbd className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-xs">
            ⌘ K
          </kbd>
        </div>
        <div className="truncate">{t("brand.encryption")}</div>
      </div>
    </aside>
  );
}
