"use client";

import { AppearanceSwitcher } from "@/components/appearance/appearance-switcher";
import { LocaleSwitcher } from "@/components/nav/locale-switcher";
import { NotificationsBell } from "@/components/nav/notifications-bell";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { syncAllAccounts } from "@/server/actions/instances";
import { Moon, Plus, RefreshCw, Search, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { currentNavItem } from "./nav-model";
import { openCommandPalette } from "./shell-events";

export function Topbar({ user, compact = false }: { user?: ReactNode; compact?: boolean }) {
  const t = useTranslations("nav");
  const tShell = useTranslations("shell");
  const pathname = usePathname();
  const current = currentNavItem(pathname);
  const { resolvedTheme, setTheme } = useTheme();
  const [pending, start] = useTransition();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function syncNow() {
    start(async () => {
      try {
        const r = await syncAllAccounts();
        toast.success(t("synced", { accounts: r.accounts, instances: r.instances }));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("syncFailed"));
      }
    });
  }

  return (
    <header data-vmui-topbar className="sticky top-0 z-[var(--z-topbar)] border-b border-border bg-[color-mix(in_oklch,var(--color-bg)_70%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="flex h-14 items-center justify-between gap-2 px-4 sm:px-6 lg:px-10">
      <nav aria-label={t("controlPlane")} className="flex min-w-0 items-center gap-2 text-sm text-muted">
        <span className="hidden truncate sm:inline">{t("controlPlane")}</span>
        {current && (
          <>
            <span className="hidden opacity-40 sm:inline" aria-hidden>/</span>
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-fg">
              <current.icon className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{tShell(`items.${current.id}` as Parameters<typeof tShell>[0])}</span>
            </span>
          </>
        )}
      </nav>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label={tShell("topbar.search")}
              className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] px-2 text-sm text-muted transition-colors hover:bg-[color-mix(in_oklch,var(--color-fg)_8%,transparent)] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--color-primary)_55%,transparent)] sm:h-9 md:w-56 md:justify-start md:border md:border-border md:bg-bg-muted md:px-3"
            >
              <Search className="size-4 shrink-0" aria-hidden />
              <span className="hidden flex-1 truncate text-left md:inline">{tShell("topbar.searchHint")}</span>
              <Kbd className="hidden md:inline-flex">⌘K</Kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent className="md:hidden">{tShell("brand.commandPalette")}</TooltipContent>
        </Tooltip>

        <NotificationsBell />

        <LocaleSwitcher />

        <AppearanceSwitcher />

        {!compact && <div className="hidden sm:block"><Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={syncNow}
              disabled={pending}
              aria-label={t("syncNow")}
            >
              <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("syncAll")}</TooltipContent>
        </Tooltip></div>}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label={t("toggleTheme")}
              suppressHydrationWarning
            >
              {mounted ? (
                resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4 opacity-0" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("toggleTheme")}</TooltipContent>
        </Tooltip>

        {!compact && <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link href="/instances/new" aria-label={t("newInstance")}>
            <Plus className="h-4 w-4" /> <span className="hidden md:inline">{t("newInstance")}</span>
          </Link>
        </Button>}
        {user && <div className="ml-0.5 border-l border-border pl-1.5 sm:ml-1 sm:pl-3">{user}</div>}
      </div>
      </div>
    </header>
  );
}
