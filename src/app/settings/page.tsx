import { Settings as SettingsIcon, KeyRound, Database, Server, Globe, Activity, Cpu, ShieldCheck, ShieldAlert, ArrowRight, Key, Users, Smartphone } from "lucide-react";
import Link from "next/link";
import { getSettings } from "@/server/queries/settings";
import { BackupCard } from "@/components/settings/backup-card";
import { KnownHostsCard } from "@/components/settings/known-hosts-card";
import { WebhooksCard } from "@/components/settings/webhooks-card";
import { BootScriptsCard } from "@/components/settings/boot-scripts-card";
import { InstallButton } from "@/components/pwa/install-prompt";
import { PushManager } from "@/components/pwa/push-manager";
import { listKnownHostsAction } from "@/server/actions/known-hosts";
import { listWebhooksAction } from "@/server/actions/webhooks";
import { listBootScriptsAction } from "@/server/actions/boot-scripts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function formatBytes(b: number | null): string {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default async function SettingsPage() {
  const [s, knownHosts, webhooks, bootScripts] = await Promise.all([
    getSettings(),
    listKnownHostsAction(),
    listWebhooksAction(),
    listBootScriptsAction(),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white shadow-[var(--shadow-glow)]">
          <SettingsIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted">Local environment, security, and provider availability.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4" /> Master encryption key
              </CardTitle>
              {s.masterKeySet ? (
                <Badge variant="success">
                  <ShieldCheck className="h-3 w-3" /> set
                </Badge>
              ) : (
                <Badge variant="danger">
                  <ShieldAlert className="h-3 w-3" /> missing
                </Badge>
              )}
            </div>
            <CardDescription>
              AES-256-GCM. Used to encrypt all cloud credentials at rest.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Fingerprint" v={s.masterKeyFingerprint ?? "—"} mono />
            <Row k="Source" v="VMUI_MASTER_KEY · .env" />
            <p className="pt-2 text-xs text-muted">
              Lose this key and you must re-add every account. Generate a new one with{" "}
              <code className="rounded bg-[var(--color-bg-muted)] px-1 py-0.5 font-mono">pnpm keygen</code>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4" /> Local database
            </CardTitle>
            <CardDescription>SQLite via better-sqlite3.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Path" v={s.dbPath} mono />
            <Row k="Resolved" v={s.dbAbsolutePath} mono small />
            <Row k="Size" v={formatBytes(s.dbSizeBytes)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4" /> Networking
            </CardTitle>
            <CardDescription>The app binds locally only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Bind" v={`${s.bindAddress}:${s.bindPort}`} mono />
            <Row k="Background sync" v={`${s.syncIntervalMs / 1000}s`} />
            <Row k="Mode" v={s.nodeEnv} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4" /> Telemetry
            </CardTitle>
            <CardDescription>What vmui knows about your fleet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row k="Accounts" v={String(s.counts.accounts)} />
            <Row k="Instances" v={String(s.counts.instances)} />
            <Row k="Audit entries" v={String(s.counts.auditEntries)} />
            <Row k="App version" v={s.appVersion} mono />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="h-4 w-4" /> SSH keys
          </CardTitle>
          <CardDescription>Stored, generated and exported as ~/.ssh/config snippets.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/settings/ssh-keys"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
          >
            Manage keys <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Key className="h-4 w-4" /> API keys
          </CardTitle>
          <CardDescription>Bearer tokens for the public /api/v1 surface.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/settings/api-keys"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
          >
            Manage API keys <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4" /> Users
          </CardTitle>
          <CardDescription>Local user accounts and roles.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/settings/users"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
          >
            Manage users <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </CardContent>
      </Card>

      <BackupCard />

      <KnownHostsCard initial={knownHosts} />
      <WebhooksCard initial={webhooks} />
      <BootScriptsCard initial={bootScripts} />
      <PwaCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Cpu className="h-4 w-4" /> Cloud providers
          </CardTitle>
          <CardDescription>Plug-and-play registry. Disabled providers are on the roadmap.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-[var(--color-border)] text-sm">
            {s.providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted" />
                  <span className="font-medium">{p.label}</span>
                  <code className="text-[11px] text-muted">{p.id}</code>
                </div>
                {p.available ? (
                  <Badge variant="success">available</Badge>
                ) : (
                  <Badge variant="muted">soon</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Keyboard shortcuts</CardTitle>
          <CardDescription>Navigate vmui without leaving the keyboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            <Shortcut k="⌘ K" desc="Open command palette" />
            <Shortcut k="?" desc="Show keyboard shortcuts" />
            <Shortcut k="/" desc="Focus search on dashboard" />
            <Shortcut k="G then I" desc="Go to instances" />
            <Shortcut k="G then A" desc="Go to accounts" />
            <Shortcut k="G then L" desc="Go to activity log" />
            <Shortcut k="G then S" desc="Go to settings" />
            <Shortcut k="N" desc="Launch new instance" />
            <Shortcut k="R" desc="Sync all accounts" />
            <Shortcut k="T" desc="Toggle theme" />
            <Shortcut k="Esc" desc="Clear selection / close dialog" />
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ k, v, mono, small }: { k: string; v: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="text-xs uppercase tracking-wider text-muted">{k}</div>
      <div
        className={`min-w-0 truncate text-right ${mono ? "font-mono" : ""} ${small ? "text-xs" : ""}`}
        title={v}
      >
        {v}
      </div>
    </div>
  );
}

function Shortcut({ k, desc }: { k: string; desc: string }) {
  return (
    <li className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2">
      <span className="text-muted">{desc}</span>
      <kbd className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 font-mono text-[11px]">
        {k}
      </kbd>
    </li>
  );
}

function PwaCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Smartphone className="h-4 w-4" /> Progressive Web App
        </CardTitle>
        <CardDescription>
          Install vmui to your home screen, enable push notifications for VM/build/alert events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wider text-muted">Install</div>
          <InstallButton />
        </div>
        <div>
          <div className="mb-1 text-xs uppercase tracking-wider text-muted">Notifications</div>
          <PushManager />
          <p className="mt-2 text-[10px] text-muted">
            Requires VAPID keys in <code>.env</code>: <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code>,
            optional <code>VAPID_SUBJECT</code>. Generate with <code>pnpm dlx web-push generate-vapid-keys</code>.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
