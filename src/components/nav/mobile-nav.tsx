"use client";

import { cn } from "@/lib/utils";
import { Container as ContainerIcon, House, Menu, Server, TerminalSquare, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { isNavActive, NAV_GROUPS, NAV_SETTINGS, type NavItem } from "./nav-model";

const TABS: Array<NavItem & { labelKey: "vms" | "apps" | "shell" | null }> = [
  { id: "instances", href: "/", icon: Server, exact: true, labelKey: "vms" },
  { id: "home", href: "/home", icon: House, labelKey: null },
  { id: "containers", href: "/containers", icon: ContainerIcon, labelKey: "apps" },
  { id: "terminal", href: "/terminal", icon: TerminalSquare, labelKey: "shell" },
];

export function MobileNav() {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const [showMore, setShowMore] = useState(false);
  const inTabs = TABS.some((it) => isNavActive(pathname, it));
  const moreActive = !inTabs && pathname !== "/";

  const itemLabel = (id: string) => t(`items.${id}` as Parameters<typeof t>[0]);

  return (
    <>
      <nav
        aria-label={t("sidebar.label")}
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-surface)_92%,transparent)] backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((it) => {
          const active = isNavActive(pathname, it);
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition",
                active ? "text-[var(--color-primary)]" : "text-muted hover:text-fg",
              )}
            >
              <Icon className="size-5" aria-hidden />
              <span className="truncate">{it.labelKey ? t(`mobile.${it.labelKey}`) : itemLabel(it.id)}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setShowMore(true)}
          aria-expanded={showMore}
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition",
            moreActive ? "text-[var(--color-primary)]" : "text-muted hover:text-fg",
          )}
        >
          <Menu className="size-5" aria-hidden />
          <span className="truncate">{t("mobile.more")}</span>
        </button>
      </nav>

      {showMore && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm md:hidden" onClick={() => setShowMore(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("mobile.allSections")}
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-3 flex items-center">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{t("mobile.allSections")}</h2>
              <button type="button" onClick={() => setShowMore(false)} aria-label={t("mobile.close")} className="ml-auto rounded p-1 text-muted hover:bg-[var(--color-bg-muted)]">
                <X className="size-4" aria-hidden />
              </button>
            </header>
            <div className="space-y-4">
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
                          onClick={() => setShowMore(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex min-w-0 flex-col items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-muted)] p-3 text-center text-xs font-medium transition active:scale-95",
                            active ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "text-fg hover:bg-[var(--color-surface)]",
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
          </div>
        </div>
      )}
    </>
  );
}
