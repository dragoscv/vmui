"use client";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/server/actions/auth";
import { ChevronDown, LogOut, Settings, ShieldCheck, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useTransition } from "react";

export function UserMenu({
  user,
}: {
  user: { email: string; displayName: string; role: "admin" | "operator" | "viewer" };
}) {
  const t = useTranslations("shell.userMenu");
  const [pending, start] = useTransition();
  const initial = (user.displayName.trim()[0] ?? user.email[0] ?? "?").toUpperCase();
  const roleLabel = t(`role.${user.role}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("menu")}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] pl-1 pr-1.5 text-xs transition-colors hover:bg-[color-mix(in_oklch,var(--color-fg)_8%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--color-primary)_55%,transparent)] data-[state=open]:bg-[color-mix(in_oklch,var(--color-fg)_8%,transparent)] sm:h-9"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-primary)_20%,transparent)] text-sm font-semibold text-primary" aria-hidden>
            {initial}
          </span>
          <span className="hidden max-w-40 truncate font-medium lg:inline">{user.displayName}</span>
          <ChevronDown className="hidden size-3.5 text-muted sm:inline" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <div className="flex items-start gap-2.5 px-2.5 py-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-primary)_20%,transparent)] text-base font-semibold text-primary" aria-hidden>
            {initial}
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium">{user.displayName}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
            <Badge variant={user.role === "admin" ? "info" : user.role === "operator" ? "default" : "muted"} className="mt-1.5">
              <ShieldCheck className="size-3" aria-hidden />
              {roleLabel}
            </Badge>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="sr-only">{t("menu")}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="size-4 text-muted" aria-hidden />
            {t("account")}
          </Link>
        </DropdownMenuItem>
        {user.role === "admin" && (
          <DropdownMenuItem asChild>
            <Link href="/home?tab=settings&section=family">
              <Users className="size-4 text-muted" aria-hidden />
              {t("family")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem danger disabled={pending} onSelect={() => start(() => signOutAction())}>
          <LogOut className="size-4" aria-hidden />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
