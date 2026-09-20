"use client";

import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import { Container as ContainerIcon, House, Menu, Server, TerminalSquare, X } from "lucide-react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { isNavActive, NAV_GROUPS, NAV_SETTINGS, type NavItem } from "./nav-model";

const TABS: Array<NavItem & { labelKey: "vms" | "apps" | "shell" | null }> = [
  { id: "instances", href: "/", icon: Server, exact: true, labelKey: "vms" },
  { id: "home", href: "/home", icon: House, labelKey: null },
  { id: "containers", href: "/containers", icon: ContainerIcon, labelKey: "apps" },
  { id: "terminal", href: "/terminal", icon: TerminalSquare, labelKey: "shell" },
];

const SCROLL_THRESHOLD = 8;

function useHideOnScroll(): boolean {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useMotionValueEvent(scrollY, "change", (y) => {
    const dy = y - last.current;
    if (y <= 0) setHidden(false);
    else if (Math.abs(dy) >= SCROLL_THRESHOLD) setHidden(dy > 0);
    last.current = y;
  });
  return hidden;
}

function useSheetLock(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
}

export function MobileNav({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const [showMore, setShowMore] = useState(false);
  const hidden = useHideOnScroll();
  const titleId = useId();
  const close = () => setShowMore(false);
  useSheetLock(showMore, close);
  if (compact) return null;
  const inTabs = TABS.some((it) => isNavActive(pathname, it));
  const moreActive = !inTabs && pathname !== "/";

  const itemLabel = (id: string) => t(`items.${id}` as Parameters<typeof t>[0]);

  return (
    <>
      <motion.nav
        aria-label={t("sidebar.label")}
        animate={{ y: hidden && !showMore ? "100%" : 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-x-0 bottom-0 z-[var(--z-nav)] flex justify-around border-t border-border bg-[color-mix(in_oklch,var(--color-surface)_92%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {TABS.map((it) => {
          const active = isNavActive(pathname, it);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              onClick={() => haptic("tap")}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition",
                active ? "text-primary" : "text-muted hover:text-fg",
              )}
            >
              <span className="relative grid size-8 place-items-center">
                {active && (
                  <motion.span
                    layoutId="mobile-nav-indicator"
                    className="absolute inset-0 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_16%,transparent)]"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                    aria-hidden
                  />
                )}
                <Icon className="relative size-5" aria-hidden />
              </span>
              <span className="truncate">{it.labelKey ? t(`mobile.${it.labelKey}`) : itemLabel(it.id)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => {
            haptic("tap");
            setShowMore(true);
          }}
          aria-expanded={showMore}
          aria-haspopup="dialog"
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition",
            moreActive ? "text-primary" : "text-muted hover:text-fg",
          )}
        >
          <span className="relative grid size-8 place-items-center">
            {moreActive && (
              <motion.span
                layoutId="mobile-nav-indicator"
                className="absolute inset-0 rounded-full bg-[color-mix(in_oklch,var(--color-primary)_16%,transparent)]"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                aria-hidden
              />
            )}
            <Menu className="relative size-5" aria-hidden />
          </span>
          <span className="truncate">{t("mobile.more")}</span>
        </button>
      </motion.nav>

      <AnimatePresence>
        {showMore && (
          <motion.div
            key="more-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[var(--z-overlay)] bg-[color-mix(in_oklch,var(--color-fg)_45%,transparent)] backdrop-blur-sm md:hidden"
            onClick={close}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 80 || info.velocity.y > 600) close();
              }}
              className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-[var(--radius-xl)] border-t border-border bg-surface pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-[var(--shadow-md)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 justify-center pb-1 pt-2.5" aria-hidden>
                <span className="h-1.5 w-10 rounded-full bg-[color-mix(in_oklch,var(--color-fg)_20%,transparent)]" />
              </div>
              <header className="flex shrink-0 items-center px-4 pb-3">
                <h2 id={titleId} className="text-sm font-semibold uppercase tracking-wide text-muted">{t("mobile.allSections")}</h2>
                <button type="button" onClick={close} aria-label={t("mobile.close")} className="ml-auto rounded-[var(--radius-sm)] p-1 text-muted hover:bg-bg-muted">
                  <X className="size-4" aria-hidden />
                </button>
              </header>
              <div className="min-h-0 space-y-4 overflow-y-auto px-4 [scrollbar-width:thin]">
              {[...NAV_GROUPS, { id: "settings" as const, items: [NAV_SETTINGS] }].map((g) => (
                <section key={g.id} aria-label={g.id === "settings" ? itemLabel("settings") : t(`groups.${g.id}`)}>
                  <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted">{g.id === "settings" ? itemLabel("settings") : t(`groups.${g.id}`)}</h3>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {g.items.map((m) => {
                      const active = isNavActive(pathname, m);
                      const Icon = m.icon;
                      return (
                        <Link
                          key={m.href}
                          href={m.href}
                          onClick={() => {
                            haptic("tap");
                            close();
                          }}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-w-0 flex-col items-center gap-1 rounded-[var(--radius-md)] border border-border bg-bg-muted p-3 text-center text-xs font-medium transition active:scale-95",
                            active ? "border-primary text-primary" : "text-fg hover:bg-surface",
                          )}
                        >
                          <Icon className="size-5" aria-hidden />
                          <span className="line-clamp-2 w-full break-words leading-tight">{itemLabel(m.id)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
