"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Server, Boxes, BarChart3, KeyRound, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Mobile-only bottom navigation. Sibling of the desktop Sidebar (which is
 * hidden under md). Pinned to the bottom with safe-area-inset for PWA mode.
 */
const items = [
  { href: "/", label: "VMs", icon: Server },
  { href: "/resources", label: "Res", icon: Boxes },
  { href: "/costs", label: "Costs", icon: BarChart3 },
  { href: "/accounts", label: "Accts", icon: KeyRound },
  { href: "/activity", label: "Log", icon: Activity },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-surface)_92%,transparent)] backdrop-blur-md md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map((it) => {
        const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href));
        const Icon = it.icon;
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition",
              active ? "text-[var(--color-primary)]" : "text-muted hover:text-fg",
            )}
          >
            <Icon className="h-5 w-5" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
