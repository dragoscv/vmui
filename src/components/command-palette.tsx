"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, Server, Cloud, KeyRound, Activity, Settings, Boxes, BarChart3, Sparkles, Tag, Clock, ShieldAlert, Bell, Archive, AlertTriangle, Network, FileSearch, Package, Container, FileStack, TerminalSquare, Hammer, GitBranch, Lock, LineChart, Spline, PiggyBank, Ship, RotateCcw, Bot, Trophy, History, TrendingUp, Zap, Globe, Users } from "lucide-react";

const NAV: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; keywords?: string }[] = [
  { href: "/", label: "Dashboard", icon: Activity, keywords: "home overview" },
  { href: "/instances", label: "Instances", icon: Server, keywords: "vms machines servers" },
  { href: "/accounts", label: "Cloud accounts", icon: Cloud, keywords: "providers connect" },
  { href: "/resources", label: "Resources", icon: Boxes, keywords: "volumes networks snapshots" },
  { href: "/recipes", label: "Recipes", icon: FileStack, keywords: "compose templates" },
  { href: "/activity", label: "Activity", icon: FileSearch, keywords: "audit log history" },
  { href: "/costs", label: "Costs", icon: BarChart3, keywords: "billing spend" },
  { href: "/cost-optimizer", label: "Cost optimizer", icon: PiggyBank, keywords: "savings idle rightsize" },
  { href: "/forecast", label: "Cost forecast", icon: TrendingUp, keywords: "projection regression" },
  { href: "/schedules", label: "Schedules", icon: Clock, keywords: "cron policies" },
  { href: "/tags", label: "Tags", icon: Tag },
  { href: "/compliance", label: "Compliance", icon: ShieldAlert },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/backups", label: "Backups", icon: Archive },
  { href: "/restore", label: "Restore", icon: RotateCcw, keywords: "recover snapshot rollback" },
  { href: "/dr", label: "DR drill", icon: Zap, keywords: "chaos disaster recovery" },
  { href: "/secrets", label: "Secrets", icon: Lock, keywords: "vault credentials" },
  { href: "/gitops", label: "GitOps", icon: GitBranch },
  { href: "/recipes/builds", label: "Builds", icon: Hammer },
  { href: "/k8s", label: "Kubernetes", icon: Ship, keywords: "k3s k0s helm cluster" },
  { href: "/monitoring", label: "Monitoring", icon: LineChart, keywords: "prometheus grafana node-exporter" },
  { href: "/mesh", label: "Mesh", icon: Spline, keywords: "wireguard tailscale vpn" },
  { href: "/ai", label: "AI Agent", icon: Bot, keywords: "chat ollama llm" },
  { href: "/timeline", label: "Time machine", icon: History, keywords: "scrub probe samples" },
  { href: "/achievements", label: "Achievements", icon: Trophy, keywords: "badges streaks xp" },
  { href: "/status", label: "Public status", icon: Globe },
  { href: "/teams", label: "Teams", icon: Users },
  { href: "/anomalies", label: "Cost anomalies", icon: AlertTriangle, keywords: "z-score spend spike" },
  { href: "/recordings", label: "Terminal recordings", icon: TerminalSquare, keywords: "asciinema cast replay" },
  { href: "/runbooks", label: "Runbooks", icon: FileStack, keywords: "markdown procedures playbook" },
  { href: "/budgets", label: "Tag budgets", icon: PiggyBank, keywords: "cap monthly alert" },
  { href: "/auto-park", label: "Idle auto-park", icon: Activity, keywords: "stop idle low cpu" },
  { href: "/key-rotation", label: "SSH key rotation", icon: KeyRound, keywords: "rotate authorized_keys fleet" },
  { href: "/digest", label: "What changed (digest)", icon: Sparkles, keywords: "hourly summary recap" },
  { href: "/settings", label: "Settings", icon: Settings },
];

const ACTIONS: { id: string; label: string; href: string; icon: React.ComponentType<{ className?: string }>; keywords?: string }[] = [
  { id: "new-vm", label: "Launch a new VM", href: "/instances/new", icon: Server, keywords: "create provision" },
  { id: "new-account", label: "Connect a cloud account", href: "/onboarding", icon: Cloud, keywords: "add provider credentials" },
  { id: "new-recipe", label: "New compose recipe", href: "/recipes", icon: Container, keywords: "docker compose stack" },
  { id: "new-key", label: "New SSH key", href: "/settings#keys", icon: KeyRound },
  { id: "new-image", label: "Build an image", href: "/recipes/builds", icon: Package },
  { id: "new-alert", label: "Create alert rule", href: "/notifications", icon: AlertTriangle, keywords: "notify webhook" },
  { id: "new-network", label: "New network", href: "/resources?kind=network", icon: Network },
  { id: "open-terminal", label: "Open SSH terminal", href: "/instances", icon: TerminalSquare, keywords: "shell connect" },
  { id: "sparkles", label: "Magic — surprise me", href: "/ai", icon: Sparkles, keywords: "random fun ai" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/60 p-4 pt-[10vh]" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <Command label="Command palette" className="overflow-hidden rounded-xl">
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3">
            <Search className="h-4 w-4 text-muted" />
            <Command.Input placeholder="Type a page or action…" className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted" />
            <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] text-muted">esc</kbd>
          </div>
          <Command.List className="max-h-[60vh] overflow-y-auto p-2 text-sm">
            <Command.Empty className="p-4 text-center text-xs text-muted">No matches.</Command.Empty>
            <Command.Group heading="Navigate">
              {NAV.map((n) => (
                <Command.Item key={n.href} value={`${n.label} ${n.keywords ?? ""}`} onSelect={() => go(n.href)} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 aria-selected:bg-[var(--color-primary)]/15">
                  <n.icon className="h-3 w-3 text-muted" />
                  <span>{n.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted">{n.href}</span>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Actions" className="mt-2">
              {ACTIONS.map((a) => (
                <Command.Item key={a.id} value={`${a.label} ${a.keywords ?? ""}`} onSelect={() => go(a.href)} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 aria-selected:bg-[var(--color-primary)]/15">
                  <a.icon className="h-3 w-3 text-[var(--color-primary)]" />
                  <span>{a.label}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
          <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2 text-[10px] text-muted">
            <span>Open with <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1">⌘K</kbd> or <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1">Ctrl+K</kbd></span>
            <span>↑↓ to navigate · ⏎ to select</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
