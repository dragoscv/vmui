"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Server,
  Container as ContainerIcon,
  TerminalSquare,
  Menu,
  X,
  KeyRound,
  Cloud,
  BarChart3,
  Tag,
  Clock,
  ShieldAlert,
  Bell,
  Sparkles,
  Network,
  FileSearch,
  Package,
  FileStack,
  Hammer,
  Activity,
  Boxes,
  PiggyBank,
  BookOpen,
  Pause,
  TrendingUp,
  History,
  RotateCcw,
  Bot,
  Trophy,
  Spline,
  Ship,
  GitBranch,
  Lock,
  Globe,
  Users,
  Zap,
  AlertTriangle,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/", label: "Home", icon: Home, exact: true },
  { href: "/instances", label: "VMs", icon: Server },
  { href: "/containers", label: "Apps", icon: ContainerIcon },
  { href: "/terminal", label: "Shell", icon: TerminalSquare },
];

const more = [
  { href: "/builds", label: "Builds", icon: Hammer },
  { href: "/compose", label: "Compose", icon: FileStack },
  { href: "/recipes", label: "Recipes", icon: Sparkles },
  { href: "/catalog", label: "Catalog", icon: Package },
  { href: "/resources", label: "Resources", icon: Boxes },
  { href: "/accounts", label: "Accounts", icon: KeyRound },
  { href: "/costs", label: "Costs", icon: BarChart3 },
  { href: "/tags", label: "Tags", icon: Tag },
  { href: "/schedules", label: "Schedules", icon: Clock },
  { href: "/compliance", label: "Compliance", icon: ShieldAlert },
  { href: "/notifications", label: "Alerts", icon: Bell },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/logs", label: "Logs", icon: FileSearch },
  { href: "/cloud", label: "Cloud", icon: Cloud },
  { href: "/topology", label: "Topology", icon: Network },
  { href: "/cost-optimizer", label: "Optimize", icon: PiggyBank },
  { href: "/forecast", label: "Forecast", icon: TrendingUp },
  { href: "/anomalies", label: "Anomalies", icon: AlertTriangle },
  { href: "/budgets", label: "Budgets", icon: PiggyBank },
  { href: "/runbooks", label: "Runbooks", icon: BookOpen },
  { href: "/auto-park", label: "Auto-park", icon: Pause },
  { href: "/key-rotation", label: "Rotate keys", icon: KeyRound },
  { href: "/recordings", label: "Recordings", icon: TerminalSquare },
  { href: "/timeline", label: "Timeline", icon: History },
  { href: "/restore", label: "Restore", icon: RotateCcw },
  { href: "/dr", label: "DR drill", icon: Zap },
  { href: "/digest", label: "Digest", icon: Sparkles },
  { href: "/burn-rate", label: "Burn rate", icon: PiggyBank },
  { href: "/fleet-diff", label: "Fleet diff", icon: History },
  { href: "/auto-tag", label: "Auto-tag", icon: Tag },
  { href: "/heatmap", label: "Heatmap", icon: AlertTriangle },
  { href: "/config-backup", label: "Config", icon: KeyRound },
  { href: "/action-history", label: "History", icon: History },
  { href: "/cost-recos", label: "Cost recos", icon: PiggyBank },
  { href: "/templates", label: "Templates", icon: FileStack },
  { href: "/account-budgets", label: "Acct budgets", icon: PiggyBank },
  { href: "/provider-status", label: "Provider status", icon: Activity },
  { href: "/tag-drift", label: "Tag drift", icon: Tag },
  { href: "/saved-searches", label: "Saved searches", icon: FileStack },
  { href: "/instance-webhooks", label: "Instance webhooks", icon: Activity },
  { href: "/account-forecast", label: "Spend forecast", icon: PiggyBank },
  { href: "/audit-chain", label: "Audit chain", icon: ShieldCheck },
  { href: "/region-map", label: "Region map", icon: Globe },
  { href: "/ai", label: "AI", icon: Bot },
  { href: "/k8s", label: "Kubernetes", icon: Ship },
  { href: "/mesh", label: "Mesh", icon: Spline },
  { href: "/gitops", label: "GitOps", icon: GitBranch },
  { href: "/secrets", label: "Secrets", icon: Lock },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/achievements", label: "Badges", icon: Trophy },
  { href: "/status", label: "Status", icon: Globe },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);
  const moreActive = more.some(
    (m) => pathname === m.href || pathname.startsWith(`${m.href}/`),
  );

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-surface)_92%,transparent)] backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs.map((it) => {
          const active = it.exact
            ? pathname === it.href
            : pathname === it.href || pathname.startsWith(`${it.href}/`);
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
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition",
            moreActive ? "text-[var(--color-primary)]" : "text-muted hover:text-fg",
          )}
        >
          <Menu className="h-5 w-5" />
          More
        </button>
      </nav>

      {showMore && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setShowMore(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-3 flex items-center">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                All sections
              </h2>
              <button
                type="button"
                onClick={() => setShowMore(false)}
                className="ml-auto rounded p-1 text-muted hover:bg-[var(--color-surface-muted)]"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {more.map((m) => {
                const active =
                  pathname === m.href || pathname.startsWith(`${m.href}/`);
                const Icon = m.icon;
                return (
                  <Link
                    key={m.href}
                    href={m.href}
                    onClick={() => setShowMore(false)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-[11px] font-medium transition active:scale-95",
                      active
                        ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                        : "text-fg hover:bg-[var(--color-surface)]",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{m.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
