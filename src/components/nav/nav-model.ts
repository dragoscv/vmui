import {
    Activity,
    AlertTriangle,
    Archive,
    BarChart3,
    Bell,
    BookOpen,
    Bot,
    Boxes,
    Clock,
    Cloud,
    Container,
    FileSearch,
    FileStack,
    GitBranch,
    Globe,
    Hammer,
    History,
    House,
    KeyRound,
    LineChart,
    Lock,
    Network,
    Package,
    Pause,
    PiggyBank,
    RotateCcw,
    Server,
    Settings,
    ShieldAlert,
    ShieldCheck,
    Ship,
    Sparkles,
    Spline,
    Tag,
    TerminalSquare,
    Trash2,
    TrendingUp,
    Trophy,
    Users,
    Zap,
    type LucideIcon,
} from "lucide-react";

export type NavItem = { id: string; href: string; icon: LucideIcon; exact?: boolean };
export type NavGroup = { id: "cloud" | "ops" | "observe" | "govern" | "more"; items: NavItem[] };

/** Always visible, above the groups. */
export const NAV_PRIMARY: NavItem[] = [
  { id: "home", href: "/home", icon: House },
  { id: "instances", href: "/", icon: Server, exact: true },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "cloud",
    items: [
      { id: "resources", href: "/resources", icon: Boxes },
      { id: "accounts", href: "/accounts", icon: KeyRound },
      { id: "costs", href: "/costs", icon: BarChart3 },
      { id: "costOptimizer", href: "/cost-optimizer", icon: PiggyBank },
      { id: "forecast", href: "/forecast", icon: TrendingUp },
      { id: "topology", href: "/topology", icon: Network },
      { id: "catalog", href: "/catalog", icon: Package },
      { id: "recipes", href: "/recipes", icon: Sparkles },
      { id: "tags", href: "/tags", icon: Tag },
      { id: "schedules", href: "/schedules", icon: Clock },
      { id: "backups", href: "/backups", icon: Archive },
      { id: "restore", href: "/restore", icon: RotateCcw },
    ],
  },
  {
    id: "ops",
    items: [
      { id: "containers", href: "/containers", icon: Container },
      { id: "compose", href: "/compose", icon: FileStack },
      { id: "terminal", href: "/terminal", icon: TerminalSquare },
      { id: "builds", href: "/builds", icon: Hammer },
      { id: "gitops", href: "/gitops", icon: GitBranch },
      { id: "k8s", href: "/k8s", icon: Ship },
      { id: "mesh", href: "/mesh", icon: Spline },
      { id: "ai", href: "/ai", icon: Bot },
      { id: "dr", href: "/dr", icon: Zap },
    ],
  },
  {
    id: "observe",
    items: [
      { id: "monitoring", href: "/monitoring", icon: LineChart },
      { id: "alerts", href: "/alerts", icon: AlertTriangle },
      { id: "notifications", href: "/notifications", icon: Bell },
      { id: "activity", href: "/activity", icon: Activity },
      { id: "logs", href: "/logs", icon: FileSearch },
      { id: "timeline", href: "/timeline", icon: History },
      { id: "status", href: "/status", icon: Globe },
    ],
  },
  {
    id: "govern",
    items: [
      { id: "compliance", href: "/compliance", icon: ShieldAlert },
      { id: "secrets", href: "/secrets", icon: Lock },
      { id: "teams", href: "/teams", icon: Users },
      { id: "achievements", href: "/achievements", icon: Trophy },
    ],
  },
  {
    id: "more",
    items: [
      { id: "cloud", href: "/cloud", icon: Cloud },
      { id: "anomalies", href: "/anomalies", icon: AlertTriangle },
      { id: "budgets", href: "/budgets", icon: PiggyBank },
      { id: "runbooks", href: "/runbooks", icon: BookOpen },
      { id: "autoPark", href: "/auto-park", icon: Pause },
      { id: "keyRotation", href: "/key-rotation", icon: KeyRound },
      { id: "recordings", href: "/recordings", icon: TerminalSquare },
      { id: "digest", href: "/digest", icon: Sparkles },
      { id: "burnRate", href: "/burn-rate", icon: PiggyBank },
      { id: "fleetDiff", href: "/fleet-diff", icon: History },
      { id: "autoTag", href: "/auto-tag", icon: Tag },
      { id: "heatmap", href: "/heatmap", icon: AlertTriangle },
      { id: "configBackup", href: "/config-backup", icon: KeyRound },
      { id: "actionHistory", href: "/action-history", icon: History },
      { id: "costRecos", href: "/cost-recos", icon: PiggyBank },
      { id: "templates", href: "/templates", icon: FileStack },
      { id: "accountBudgets", href: "/account-budgets", icon: PiggyBank },
      { id: "providerStatus", href: "/provider-status", icon: Activity },
      { id: "tagDrift", href: "/tag-drift", icon: Tag },
      { id: "savedSearches", href: "/saved-searches", icon: FileStack },
      { id: "instanceWebhooks", href: "/instance-webhooks", icon: Activity },
      { id: "accountForecast", href: "/account-forecast", icon: PiggyBank },
      { id: "auditChain", href: "/audit-chain", icon: ShieldCheck },
      { id: "regionMap", href: "/region-map", icon: Globe },
      { id: "bootScriptDiff", href: "/boot-script-diff", icon: FileStack },
      { id: "tagPolicies", href: "/tag-policies", icon: Tag },
      { id: "trash", href: "/trash", icon: Trash2 },
      { id: "billExplainer", href: "/bill-explainer", icon: PiggyBank },
      { id: "anomalyPlayback", href: "/anomaly-playback", icon: Activity },
      { id: "maintenance", href: "/maintenance", icon: Clock },
      { id: "changelog", href: "/changelog", icon: BookOpen },
      { id: "spendHeatmap", href: "/spend-heatmap", icon: AlertTriangle },
      { id: "webhookDeliveries", href: "/webhook-deliveries", icon: Activity },
      { id: "cis", href: "/cis", icon: ShieldCheck },
    ],
  },
];

export const NAV_SETTINGS: NavItem = { id: "settings", href: "/settings", icon: Settings };

export const NAV_ALL: NavItem[] = [...NAV_PRIMARY, ...NAV_GROUPS.flatMap((g) => g.items), NAV_SETTINGS];

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.exact || item.href === "/") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Longest matching route wins, so `/costs/recommendations` resolves to Costs, not Instances. */
export function currentNavItem(pathname: string): NavItem | undefined {
  return NAV_ALL.filter((it) => isNavActive(pathname, it)).sort((a, b) => b.href.length - a.href.length)[0];
}
