"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  ShieldCheck,
  RefreshCw,
  Terminal,
  KeyRound,
  HelpCircle,
  CheckCircle2,
  AlertCircle,
  Copy,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  addAwsAccount,
  importAwsProfile,
  listAwsProfilesAction,
  type AwsAccountFormState,
  type AwsProfileInfo,
} from "@/server/actions/accounts";
import { useActionState } from "react";

const REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1",
  "ap-northeast-1", "ap-southeast-1", "ap-southeast-2", "ap-south-1",
];

export function AwsAccountConnect() {
  return (
    <Tabs defaultValue="cli" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="cli">
          <Terminal className="mr-1.5 h-3.5 w-3.5" /> AWS CLI profile
        </TabsTrigger>
        <TabsTrigger value="keys">
          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Access keys
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Guided setup
        </TabsTrigger>
      </TabsList>

      <TabsContent value="cli">
        <CliProfilesPanel />
      </TabsContent>
      <TabsContent value="keys">
        <AccessKeysPanel />
      </TabsContent>
      <TabsContent value="help">
        <GuidedSetupPanel />
      </TabsContent>
    </Tabs>
  );
}

/* ----------------------------- CLI Profiles ----------------------------- */

function CliProfilesPanel() {
  const [loading, setLoading] = useState(true);
  const [cliInstalled, setCliInstalled] = useState(true);
  const [profiles, setProfiles] = useState<AwsProfileInfo[]>([]);
  const [refreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      setLoading(true);
      const r = await listAwsProfilesAction();
      setCliInstalled(r.cliInstalled);
      setProfiles(r.profiles);
      setLoading(false);
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Import from AWS CLI</h2>
            <p className="text-xs text-muted">
              Auto-detected from <code className="rounded bg-[var(--color-bg-muted)] px-1">~/.aws/credentials</code> and{" "}
              <code className="rounded bg-[var(--color-bg-muted)] px-1">~/.aws/config</code>.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={refresh} disabled={refreshing} aria-label="Refresh profiles">
            <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…
          </div>
        ) : !cliInstalled ? (
          <NoCliWarning />
        ) : profiles.length === 0 ? (
          <NoProfilesWarning />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {profiles.map((p) => (
              <ProfileRow key={p.name} profile={p} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileRow({ profile }: { profile: AwsProfileInfo }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile.name === "default" ? "AWS (default)" : profile.name);
  const [region, setRegion] = useState(profile.region ?? "us-east-1");
  const [state, action, pending] = useActionState(importAwsProfile, {} as AwsAccountFormState);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      toast.success(`Imported "${profile.name}" successfully`);
      router.push("/");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, profile.name, router]);

  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-bg-muted)]">
          <Terminal className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{profile.name}</span>
            {profile.isSso && <Badge variant="info">SSO</Badge>}
            {profile.hasStaticKeys && <Badge variant="muted">static keys</Badge>}
            {profile.region && <span className="text-xs text-muted">· {profile.region}</span>}
          </div>
          {profile.ssoStartUrl && <div className="truncate text-xs text-muted">{profile.ssoStartUrl}</div>}
        </div>
        <Button variant={open ? "ghost" : "secondary"} size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Import"}
        </Button>
      </div>

      {open && (
        <form action={action} className="mt-3 grid gap-3 rounded-md bg-[var(--color-bg-muted)] p-3 sm:grid-cols-2">
          <input type="hidden" name="profile" value={profile.name} />
          <div className="space-y-1.5">
            <Label htmlFor={`name-${profile.name}`} className="text-xs">
              Display name
            </Label>
            <Input id={`name-${profile.name}`} name="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`region-${profile.name}`} className="text-xs">
              Default region
            </Label>
            <select
              id={`region-${profile.name}`}
              name="region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          {profile.isSso && !profile.hasStaticKeys && (
            <div className="sm:col-span-2 flex items-start gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)] p-2 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 text-[var(--color-warning)]" />
              <div>
                Make sure you've logged in first — run{" "}
                <CodePill text={`aws sso login --profile ${profile.name}`} /> in your terminal.
              </div>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Verifying with AWS…</>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Verify & import
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function NoCliWarning() {
  return (
    <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-sm">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-[var(--color-warning)]" />
        <div className="space-y-2">
          <p className="font-medium">AWS CLI not found on PATH.</p>
          <p className="text-muted">
            Install the AWS CLI v2 to import profiles automatically, or use <strong>Access keys</strong> tab.
          </p>
          <div className="space-y-1.5">
            <CodeBlock label="Windows (winget)" code="winget install -e --id Amazon.AWSCLI" />
            <CodeBlock label="macOS (Homebrew)" code="brew install awscli" />
          </div>
          <p className="text-xs text-muted">
            After installing, run <CodePill text="aws configure" /> (for static keys) or{" "}
            <CodePill text="aws configure sso" /> (for AWS SSO / IAM Identity Center), then refresh this page.
          </p>
        </div>
      </div>
    </div>
  );
}

function NoProfilesWarning() {
  return (
    <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-sm">
      <div className="space-y-3">
        <p className="font-medium">No AWS CLI profiles found yet.</p>
        <p className="text-muted">Configure one with either of the commands below, then click refresh.</p>
        <CodeBlock label="Static IAM user keys" code="aws configure --profile vmui" />
        <CodeBlock label="AWS SSO / IAM Identity Center" code="aws configure sso --profile vmui-sso" />
      </div>
    </div>
  );
}

/* ------------------------------ Access Keys ----------------------------- */

function AccessKeysPanel() {
  const [state, action, pending] = useActionState(addAwsAccount, {} as AwsAccountFormState);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      toast.success("AWS account connected");
      router.push("/");
      router.refresh();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 text-sm text-[var(--color-success)]">
          <ShieldCheck className="h-4 w-4" />
          Stored encrypted at rest with AES-256-GCM
        </div>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <Field
            label="Friendly name"
            name="name"
            placeholder="Personal AWS"
            description="Just a label shown in vmui."
            error={state.fieldErrors?.name}
          />
          <Field
            label="Access Key ID"
            name="accessKeyId"
            placeholder="AKIA…"
            autoComplete="off"
            description="Starts with AKIA (long-term) or ASIA (temporary). From IAM → Users → Security credentials → Create access key."
            error={state.fieldErrors?.accessKeyId}
          />
          <Field
            label="Secret Access Key"
            name="secretAccessKey"
            type="password"
            autoComplete="off"
            description="Shown only once at creation. If lost, create a new key pair."
            error={state.fieldErrors?.secretAccessKey}
          />
          <Field
            label="Session token"
            name="sessionToken"
            type="password"
            autoComplete="off"
            description="Required only for temporary credentials (AWS SSO / STS / role assumption)."
          />

          <div className="space-y-1.5">
            <Label htmlFor="defaultRegion">Default region</Label>
            <select
              id="defaultRegion"
              name="defaultRegion"
              defaultValue="us-east-1"
              className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklch,var(--color-primary)_55%,transparent)]"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="text-xs text-muted">
              The region vmui queries by default. macOS dedicated hosts have limited regional availability —{" "}
              <code>us-east-1</code> and <code>us-west-2</code> are the safest.
            </p>
            {state.fieldErrors?.defaultRegion && (
              <p className="text-xs text-[var(--color-danger)]">{state.fieldErrors.defaultRegion}</p>
            )}
          </div>

          <Button type="submit" disabled={pending} className="w-full">
            {pending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Verifying with AWS…</>
            ) : (
              "Verify & connect"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  name,
  description,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  name: string;
  description?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...rest} />
      {description && <p className="text-xs text-muted">{description}</p>}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

/* ----------------------------- Guided setup ----------------------------- */

function GuidedSetupPanel() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <h2 className="font-semibold">Pick your path</h2>
          <p className="text-sm text-muted">
            Two clean ways to connect AWS. Use SSO if your company uses Identity Center; otherwise an IAM user is the
            quickest.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <PathCard
            title="A · IAM user (personal)"
            subtitle="Static long-term access keys"
            steps={[
              "Best for personal/sandbox accounts.",
              "vmui will use the access key directly.",
              "~5 minutes.",
            ]}
            color="primary"
          />
          <PathCard
            title="B · AWS SSO / Identity Center"
            subtitle="Temporary creds via browser login"
            steps={[
              "Best for company accounts.",
              "You log in via browser; vmui imports the temporary creds.",
              "~3 minutes if SSO is already set up.",
            ]}
            color="accent"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Path A — Create an IAM user</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <Step n={1} title="Sign in to the AWS Console">
            Open{" "}
            <a
              href="https://console.aws.amazon.com/iam/home#/users"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              IAM → Users
            </a>{" "}
            (or run the CLI commands below if you already have admin keys).
          </Step>
          <Step n={2} title="Create a user named vmui-controller">
            <CodeBlock
              code={`aws iam create-user --user-name vmui-controller
aws iam attach-user-policy --user-name vmui-controller \\
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess
aws iam create-access-key --user-name vmui-controller`}
            />
            <p className="text-xs text-muted">
              The last command prints <code>AccessKeyId</code> and <code>SecretAccessKey</code>. Copy both.
            </p>
          </Step>
          <Step n={3} title="Pick how to feed them to vmui">
            <div className="grid gap-2 sm:grid-cols-2">
              <SubStep label="Recommended: configure CLI">
                <CodeBlock code={`aws configure --profile vmui`} />
                Then go to the <strong>AWS CLI profile</strong> tab and click <strong>Import</strong>.
              </SubStep>
              <SubStep label="Or: paste directly">
                Switch to the <strong>Access keys</strong> tab and paste them there.
              </SubStep>
            </div>
          </Step>
          <Note>
            For tighter security, replace <code>AmazonEC2FullAccess</code> with a custom policy granting only the
            actions vmui needs (RunInstances, StartInstances, StopInstances, DescribeInstances, etc.).
          </Note>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Path B — AWS SSO / IAM Identity Center</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <Step n={1} title="Configure your SSO profile (one-time)">
            <CodeBlock code={`aws configure sso --profile vmui-sso`} />
            <p className="text-xs text-muted">
              The CLI will ask for the start URL (e.g. <code>https://my-org.awsapps.com/start</code>), region, account,
              and role. It opens a browser to authenticate you.
            </p>
          </Step>
          <Step n={2} title="Log in (every session)">
            <CodeBlock code={`aws sso login --profile vmui-sso`} />
            <p className="text-xs text-muted">
              Tokens last ~8h by default. Re-run this when vmui says credentials expired.
            </p>
          </Step>
          <Step n={3} title="Import in vmui">
            Open the <strong>AWS CLI profile</strong> tab — your <code>vmui-sso</code> profile will appear with an{" "}
            <Badge variant="info">SSO</Badge> badge. Click <strong>Import</strong>.
          </Step>
          <Note>
            If you don't have IAM Identity Center set up, your AWS administrator needs to enable it in the management
            account. Use Path A in the meantime.
          </Note>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Permissions vmui needs</h2>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted">
            For full functionality (list, start, stop, reboot, terminate, create, allocate Mac dedicated hosts), the
            simplest policy is:
          </p>
          <CodeBlock code="arn:aws:iam::aws:policy/AmazonEC2FullAccess" />
          <p className="text-muted">For least-privilege, the minimum actions are:</p>
          <CodeBlock
            code={`ec2:DescribeInstances
ec2:DescribeRegions
ec2:DescribeImages
ec2:DescribeHosts
ec2:RunInstances
ec2:StartInstances
ec2:StopInstances
ec2:RebootInstances
ec2:TerminateInstances
ec2:AllocateHosts          # only if you launch macOS
ec2:CreateTags
sts:GetCallerIdentity`}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PathCard({
  title,
  subtitle,
  steps,
  color,
}: {
  title: string;
  subtitle: string;
  steps: string[];
  color: "primary" | "accent";
}) {
  return (
    <div
      className="surface p-4"
      style={{
        borderColor: `color-mix(in oklch, var(--color-${color}) 35%, var(--color-border))`,
      }}
    >
      <div className="text-xs font-medium uppercase tracking-wider" style={{ color: `var(--color-${color})` }}>
        {title}
      </div>
      <div className="mt-1 font-semibold">{subtitle}</div>
      <ul className="mt-3 space-y-1 text-xs text-muted">
        {steps.map((s, i) => (
          <li key={i}>· {s}</li>
        ))}
      </ul>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-xs font-semibold text-[var(--color-primary)]">
        {n}
      </div>
      <div className="flex-1 space-y-2 pt-0.5 text-sm">
        <div className="font-medium">{title}</div>
        <div className="space-y-2 text-muted">{children}</div>
      </div>
    </div>
  );
}

function SubStep({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] p-3">
      <div className="mb-2 text-xs font-medium">{label}</div>
      <div className="space-y-2 text-xs text-muted">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-[var(--color-bg-muted)] p-3 text-xs text-muted">
      <HelpCircle className="h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------ Code blocks ----------------------------- */

function CodeBlock({ code, label }: { code: string; label?: string }) {
  function copy() {
    void navigator.clipboard.writeText(code);
    toast.success("Copied to clipboard");
  }
  return (
    <div className="space-y-1">
      {label && <div className="text-[11px] font-medium text-muted">{label}</div>}
      <div className="group relative">
        <pre className="overflow-x-auto rounded-md bg-[var(--color-bg-muted)] p-3 pr-10 font-mono text-xs leading-relaxed">
          {code}
        </pre>
        <button
          type="button"
          onClick={copy}
          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-muted opacity-0 transition-opacity hover:bg-[color-mix(in_oklch,var(--color-fg)_8%,transparent)] hover:text-[var(--color-fg)] group-hover:opacity-100"
          aria-label="Copy"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function CodePill({ text }: { text: string }) {
  function copy() {
    void navigator.clipboard.writeText(text);
    toast.success("Copied");
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded bg-[var(--color-bg-muted)] px-1.5 py-0.5 font-mono text-[11px] hover:bg-[color-mix(in_oklch,var(--color-fg)_10%,transparent)]"
    >
      {text}
      <Copy className="h-2.5 w-2.5 opacity-60" />
    </button>
  );
}
