"use client";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NotificationRow } from "@/lib/db/schema";
import {
    dismissAllNotificationsAction,
    dismissNotificationAction,
    listNotificationsAction,
    markAllSeenAction,
} from "@/server/actions/notifications";
import { AlertCircle, AlertTriangle, Bell, Check, CheckCircle2, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type BellT = ReturnType<typeof useTranslations<"misc.bell">>;

function relative(iso: string, t: BellT): string {
  const dt = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - dt);
  if (diff < 60_000) return t("justNow");
  if (diff < 3_600_000) return t("minutesAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t("hoursAgo", { n: Math.floor(diff / 3_600_000) });
  return t("daysAgo", { n: Math.floor(diff / 86_400_000) });
}

const ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
} as const;

const COLOR = {
  info: "text-[var(--color-primary)]",
  success: "text-[var(--color-success)]",
  warning: "text-warning",
  error: "text-[var(--color-danger)]",
} as const;

export function NotificationsBell() {
  const t = useTranslations("misc.bell");
  const router = useRouter();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const unseen = items.filter((n) => !n.seenAt && !n.dismissedAt).length;

  async function refresh() {
    const rows = await listNotificationsAction();
    setItems(rows);
  }

  useEffect(() => {
    refresh();
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/events");
    const onCreate = () => {
      refresh();
    };
    es.addEventListener("notification.created", onCreate);
    return () => {
      es.removeEventListener("notification.created", onCreate);
      es.close();
    };
  }, []);

  useEffect(() => {
    if (open && unseen > 0) {
      start(async () => {
        await markAllSeenAction();
        await refresh();
      });
    }
  }, [open, unseen]);

  function dismiss(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, dismissedAt: new Date() } : n)));
    start(async () => {
      await dismissNotificationAction(id);
      router.refresh();
    });
  }

  function dismissAll() {
    setItems((prev) => prev.map((n) => ({ ...n, dismissedAt: new Date() })));
    start(async () => {
      await dismissAllNotificationsAction();
      router.refresh();
    });
  }

  const visible = items.filter((n) => !n.dismissedAt).slice(0, 30);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("tooltip")} className="relative">
              <Bell className="h-4 w-4" aria-hidden />
              <AnimatePresence>
                {unseen > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-bold text-danger-fg"
                  >
                    {unseen > 99 ? "99+" : unseen}
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{unseen > 0 ? t("tooltipNew", { count: unseen }) : t("tooltip")}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-sm font-semibold">{t("title")}</div>
          {visible.length > 0 && (
            <button
              type="button"
              onClick={dismissAll}
              className="text-xs text-fg-muted hover:text-fg"
            >
              {t("clearAll")}
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {visible.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-fg-muted">
              <Check className="mx-auto mb-2 h-5 w-5 opacity-50" aria-hidden />
              {t("empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((n) => {
                const Icon = ICON[n.severity];
                const color = COLOR[n.severity];
                const created = n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt);
                const inner = (
                  <div className="flex gap-2.5">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="truncate text-sm font-medium">{n.title}</div>
                        <span className="shrink-0 text-[10px] text-fg-muted">{relative(created, t)}</span>
                      </div>
                      {n.body && <div className="mt-0.5 text-xs text-fg-muted">{n.body}</div>}
                    </div>
                  </div>
                );
                return (
                  <li
                    key={n.id}
                    className="group relative px-3 py-2.5 transition-colors hover:bg-[color-mix(in_oklch,var(--color-fg)_4%,transparent)]"
                  >
                    {n.href ? (
                      <Link href={n.href} onClick={() => setOpen(false)} className="block">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                    <button
                      type="button"
                      aria-label={t("dismiss")}
                      onClick={() => dismiss(n.id)}
                      className="absolute right-2 top-2 hidden h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-fg-muted hover:bg-bg-muted hover:text-fg focus-visible:flex group-hover:flex"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
