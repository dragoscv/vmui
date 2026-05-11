"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, RefreshCw, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { syncAllAccounts } from "@/server/actions/instances";
import { useRouter } from "next/navigation";
import { NotificationsBell } from "@/components/nav/notifications-bell";
import { VibeSwitcher } from "@/components/dashboard/vibe-switcher";

export function Topbar() {
  const { resolvedTheme, setTheme } = useTheme();
  const [pending, start] = useTransition();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  function syncNow() {
    start(async () => {
      try {
        const r = await syncAllAccounts();
        toast.success(`Synced ${r.accounts} account(s) — ${r.instances} instance(s)`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Sync failed");
      }
    });
  }

  return (
    <header data-vmui-topbar className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-bg)_70%,transparent)] px-6 backdrop-blur-md lg:px-10">
      <div className="text-sm text-muted">
        <span className="font-medium text-[var(--color-fg)]">Control plane</span>
        <span className="mx-2 opacity-40">/</span>
        <span>localhost</span>
      </div>

      <div className="flex items-center gap-2">
        <NotificationsBell />

        <VibeSwitcher />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={syncNow}
              disabled={pending}
              aria-label="Sync now"
            >
              <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Sync all accounts</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label="Toggle theme"
              suppressHydrationWarning
            >
              {mounted ? (
                resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />
              ) : (
                <Sun className="h-4 w-4 opacity-0" aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>

        <Button asChild size="sm">
          <Link href="/instances/new">
            <Plus className="h-4 w-4" /> New instance
          </Link>
        </Button>
      </div>
    </header>
  );
}
