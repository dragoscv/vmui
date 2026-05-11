import "server-only";
import Link from "next/link";
import { Sparkles, Key, Cloud, RefreshCcw, ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { cloudAccounts } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

interface Step {
  title: string;
  detail: string;
  status: "done" | "next" | "later";
  href?: string;
}

export default async function OnboardingPage() {
  const accounts = await db.select().from(cloudAccounts);
  const hasMasterKey = !!env.VMUI_MASTER_KEY;
  const hasAccount = accounts.length > 0;
  const hasSyncedAccount = accounts.some((a) => a.updatedAt && a.updatedAt.getTime() > a.createdAt.getTime() + 5_000);

  const steps: Step[] = [
    {
      title: "1. Master key",
      detail: hasMasterKey
        ? "VMUI_MASTER_KEY is set; credentials are encrypted at rest."
        : "Generate a 32-byte hex key and put it in .env.local as VMUI_MASTER_KEY before continuing.",
      status: hasMasterKey ? "done" : "next",
    },
    {
      title: "2. Connect a cloud account",
      detail: hasAccount
        ? `${accounts.length} account${accounts.length === 1 ? "" : "s"} connected.`
        : "Paste read+write API credentials for AWS, Azure, GCP, Scaleway, or local-kvm.",
      status: hasAccount ? "done" : hasMasterKey ? "next" : "later",
      href: "/accounts",
    },
    {
      title: "3. First sync",
      detail: hasSyncedAccount
        ? "Sync runs in the background every minute; force-refresh from the topbar."
        : "After connecting, run a sync to pull instances and resources into the local cache.",
      status: hasSyncedAccount ? "done" : hasAccount ? "next" : "later",
      href: "/",
    },
    {
      title: "4. (Optional) Save an SSH key",
      detail: "Generate or import a key under Settings → SSH keys to use the in-app terminal without pasting keys each time.",
      status: "later",
      href: "/settings/ssh-keys",
    },
    {
      title: "5. (Optional) Schedule auto-shutdown",
      detail: "Stop dev VMs overnight, restart them in the morning, or schedule weekly reboots.",
      status: "later",
      href: "/schedules",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-6 w-6 text-[var(--color-primary)]" />
          Welcome to vmui
        </h1>
        <p className="text-sm text-muted">
          Local-first multi-cloud control plane. Everything stays on this machine — no cloud accounts of vmui&apos;s own.
        </p>
      </div>

      <div className="grid gap-3">
        {steps.map((s) => (
          <Card key={s.title} className="surface">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {s.title}
                  {s.status === "done" && <Badge variant="success">done</Badge>}
                  {s.status === "next" && <Badge variant="info">next</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted">{s.detail}</div>
              </div>
              {s.href && s.status !== "done" && (
                <Link
                  href={s.href}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-primary)]/40 px-3 py-1 text-xs hover:bg-[var(--color-primary)]/10"
                >
                  Go <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-4 w-4" /> Generating a master key
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted">
          Run <code className="rounded bg-[var(--color-bg)] px-1 py-0.5 text-[11px]">pnpm keygen</code> in the project
          root, then add the printed line (<code className="font-mono">VMUI_MASTER_KEY=...</code>) to{" "}
          <code className="font-mono">.env.local</code>. Restart the dev server. Everything sensitive — credentials, SSH
          private keys — is sealed with AES-256-GCM using this key.
        </CardContent>
      </Card>

      <Card className="surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Cloud className="h-4 w-4" /> Provider quick reference
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-xs text-muted md:grid-cols-2">
          <div>
            <strong className="text-foreground">AWS:</strong> IAM access key + secret. Recommend a dedicated user with
            EC2 + S3 + RDS + ELB + Route53 read/write.
          </div>
          <div>
            <strong className="text-foreground">Azure:</strong> Service principal — tenantId, clientId, clientSecret,
            subscriptionId. Contributor on the target subscription.
          </div>
          <div>
            <strong className="text-foreground">GCP:</strong> Service-account JSON key. Compute, Storage, Cloud SQL,
            DNS roles. Pasted JSON is encrypted before disk.
          </div>
          <div>
            <strong className="text-foreground">Scaleway:</strong> API token + organization id.
          </div>
          <div className="md:col-span-2">
            <strong className="text-foreground">local-kvm:</strong> SSH host + key for the libvirt host. vmui talks
            directly to libvirt via the chosen URI.
          </div>
        </CardContent>
      </Card>

      <Card className="surface">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCcw className="h-4 w-4" /> What runs in the background
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted">
          A sync loop refreshes instances every minute. Schedules tick every 30 seconds. Audit logs older than 30 days
          are gzipped to disk and removed from the live table.
        </CardContent>
      </Card>
    </div>
  );
}
