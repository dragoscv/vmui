"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Server, KeyRound, Activity, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Instances", icon: Server },
  { href: "/accounts", label: "Accounts", icon: KeyRound },
  { href: "/activity", label: "Activity", icon: Activity },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-60 shrink-0 border-r border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-surface)_50%,transparent)] backdrop-blur-md md:flex md:flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-[var(--shadow-glow)]">
          <Cloud className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <div className="text-base font-semibold">vmui</div>
          <div className="text-[11px] text-muted">multi-cloud control</div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {items.map((it) => {
          const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                "group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-[var(--color-fg)]"
                  : "text-muted hover:bg-[color-mix(in_oklch,var(--color-fg)_6%,transparent)] hover:text-[var(--color-fg)]",
              )}
            >
              <Icon className={cn("h-4 w-4", active && "text-[var(--color-primary)]")} />
              {it.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto p-4 text-[11px] text-muted">
        <div>localhost:3737</div>
        <div className="mt-1">credentials encrypted at rest (AES-256-GCM)</div>
      </div>
    </aside>
  );
}
