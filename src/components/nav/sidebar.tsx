"use client";

import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChevronDown, Cloud, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { isNavActive, NAV_GROUPS, NAV_PRIMARY, NAV_SETTINGS, type NavGroup, type NavItem } from "./nav-model";
import { SIDEBAR_COLLAPSED_KEY, SIDEBAR_TOGGLE_EVENT } from "./shell-events";

const STORAGE_KEY = "vmui.sidebar.open";
const DEFAULT_OPEN: Record<NavGroup["id"], boolean> = { cloud: true, ops: true, observe: true, govern: false, more: false };

const FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } } as const;

function applyRailAttr(rail: boolean) {
  document.documentElement.dataset.sidebar = rail ? "rail" : "full";
}

function useRail(): [boolean, () => void] {
  const [rail, setRail] = React.useState(false);
  React.useEffect(() => {
    let initial: boolean;
    try {
      const raw = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      initial = raw !== null ? raw === "1" : !window.matchMedia("(min-width: 80rem)").matches;
    } catch {
      initial = false;
    }
    setRail(initial);
    applyRailAttr(initial);
  }, []);
  const toggle = React.useCallback(() => {
    setRail((r) => {
      const next = !r;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      applyRailAttr(next);
      return next;
    });
  }, []);
  React.useEffect(() => {
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, toggle);
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, toggle);
  }, [toggle]);
  return [rail, toggle];
}

function NavLink({ item, active, rail }: { item: NavItem; active: boolean; rail: boolean }) {
  const t = useTranslations("shell.items");
  const Icon = item.icon;
  const label = t(item.id as Parameters<typeof t>[0]);
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={rail ? label : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-md)] py-1.5 text-sm transition-colors",
        rail ? "justify-center px-0" : "px-3",
        active
          ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] font-medium text-fg"
          : "text-muted hover:bg-[color-mix(in_oklch,var(--color-fg)_6%,transparent)] hover:text-fg",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
      <AnimatePresence initial={false}>
        {!rail && (
          <motion.span key="label" {...FADE} className="truncate">
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
  if (!rail) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const [rail, toggleRail] = useRail();
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

  const ToggleIcon = rail ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = rail ? t("sidebar.expand") : t("sidebar.collapse");

  return (
    <motion.aside
      data-vmui-sidebar
      data-rail={rail ? "" : undefined}
      initial={false}
      animate={{ width: rail ? "var(--spacing-sidebar-rail)" : "var(--spacing-sidebar)" }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "hidden h-dvh min-w-0 shrink-0 flex-col overflow-hidden border-r border-border bg-[color-mix(in_oklch,var(--color-surface)_50%,transparent)] backdrop-blur-md md:sticky md:top-0 md:flex",
        rail ? "w-sidebar-rail" : "w-sidebar",
      )}
    >
      <Link href="/home" className={cn("flex items-center gap-2.5 pb-4 pt-5", rail ? "justify-center px-0" : "px-5")} aria-label={rail ? "vmui" : undefined}>
        <div className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-gradient-to-br from-primary to-accent text-primary-fg shadow-[var(--shadow-glow)]">
          <Cloud className="size-5" aria-hidden />
        </div>
        <AnimatePresence initial={false}>
          {!rail && (
            <motion.div key="brand" {...FADE} className="min-w-0 leading-tight">
              <div className="text-base font-semibold">vmui</div>
              <div className="truncate text-xs text-muted">{t("brand.tagline")}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </Link>

      <nav aria-label={t("sidebar.label")} className={cn("min-h-0 flex-1 overflow-y-auto pb-3 [scrollbar-width:thin]", rail ? "px-2" : "px-3")}>
        <div className="flex flex-col gap-0.5">
          {(compact ? NAV_PRIMARY.filter((it) => it.id === "home") : NAV_PRIMARY).map((it) => (
            <NavLink key={it.href} item={it} active={isNavActive(pathname, it)} rail={rail} />
          ))}
        </div>
        {!compact && NAV_GROUPS.map((g) => {
          const hasActive = g.items.some((it) => isNavActive(pathname, it));
          const expanded = rail ? hasActive : open[g.id] || hasActive;
          const bodyId = `nav-group-${g.id}`;
          const groupLabel = t(`groups.${g.id}`);
          return (
            <div key={g.id} className="mt-3">
              {rail ? (
                <div role="separator" aria-label={groupLabel} className="mx-2 mb-1 h-px bg-border" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggle(g.id)}
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  aria-label={t("sidebar.toggleGroup", { group: groupLabel })}
                  className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="truncate">{groupLabel}</span>
                  <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")} aria-hidden />
                </button>
              )}
              <div id={bodyId} hidden={!expanded} className="mt-0.5 flex flex-col gap-0.5">
                {g.items.map((it) => (
                  <NavLink key={it.href} item={it} active={isNavActive(pathname, it)} rail={rail} />
                ))}
              </div>
            </div>
          );
        })}
        {!compact && <div className="mt-3 border-t border-border pt-3">
          <NavLink item={NAV_SETTINGS} active={isNavActive(pathname, NAV_SETTINGS)} rail={rail} />
        </div>}
      </nav>

      <div className={cn("space-y-2 border-t border-border text-xs text-muted", rail ? "p-2" : "p-4")}>
        {!rail && (
          <>
            <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-border bg-bg-muted px-2 py-1.5">
              <span className="truncate">{t("brand.commandPalette")}</span>
              <Kbd className="shrink-0">⌘ K</Kbd>
            </div>
            <div className="truncate">{t("brand.encryption")}</div>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleRail}
              aria-label={toggleLabel}
              aria-pressed={rail}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-[var(--radius-md)] text-muted transition-colors hover:bg-[color-mix(in_oklch,var(--color-fg)_6%,transparent)] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                rail ? "justify-center" : "px-2",
              )}
            >
              <ToggleIcon className="size-4 shrink-0" aria-hidden />
              {!rail && <span className="truncate">{toggleLabel}</span>}
              {!rail && <Kbd className="ml-auto">[</Kbd>}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {toggleLabel} · <kbd className="font-mono">[</kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </motion.aside>
  );
}
