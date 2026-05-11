"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  ShieldCheck,
  KeyRound,
  HelpCircle,
  ExternalLink,
  Server,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  addHetznerAccount,
  type HetznerAccountFormState,
} from "@/server/actions/accounts";
import { regionsFor } from "@/lib/providers/regions";

const initial: HetznerAccountFormState = {};

export function HetznerAccountConnect() {
  return (
    <Tabs defaultValue="token" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="token">
          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> API token
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Guided setup
        </TabsTrigger>
      </TabsList>
      <TabsContent value="token">
        <TokenPanel />
      </TabsContent>
      <TabsContent value="help">
        <GuidedPanel />
      </TabsContent>
    </Tabs>
  );
}

function TokenPanel() {
  const [state, action, pending] = useActionState(addHetznerAccount, initial);
  const router = useRouter();
  const [region, setRegion] = useState("nbg1");
  const regions = regionsFor("hetzner");

  if (state.ok && state.accountId) {
    toast.success("Hetzner Cloud account connected");
    router.push("/");
    router.refresh();
  } else if (state.error && !state.fieldErrors) {
    toast.error(state.error);
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <h2 className="text-lg font-semibold">Connect with an API token</h2>
        <p className="text-xs text-muted">
          Generate a token in Hetzner Cloud Console → Security → API tokens. Use
          <strong> read &amp; write</strong> scope for full lifecycle. Token is encrypted with
          AES-256-GCM.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <Field
            name="name"
            label="Display name"
            placeholder="dragos (Hetzner)"
            description="Hetzner doesn't return a friendly project name in the API; pick whatever you want."
            error={state.fieldErrors?.name}
            required
          />
          <Field
            name="token"
            label="API token"
            placeholder="64-character alphanumeric string"
            description="Console → Security → API Tokens → Generate API Token. Read+Write recommended."
            error={state.fieldErrors?.token}
            required
            type="password"
            autoComplete="off"
          />
          <div className="grid gap-1.5">
            <Label htmlFor="defaultRegion">Default location</Label>
            <select
              id="defaultRegion"
              name="defaultRegion"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} — {r.label}
                </option>
              ))}
            </select>
            {state.fieldErrors?.defaultRegion && (
              <p className="text-xs text-[var(--color-danger)]">{state.fieldErrors.defaultRegion}</p>
            )}
          </div>
          <Button type="submit" disabled={pending} size="lg">
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Verifying with Hetzner…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" /> Verify &amp; connect
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  name,
  label,
  placeholder,
  description,
  error,
  required,
  type = "text",
  autoComplete,
}: {
  name: string;
  label: string;
  placeholder?: string;
  description?: string;
  error?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
        autoComplete={autoComplete}
      />
      {description && <p className="text-xs text-muted">{description}</p>}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function GuidedPanel() {
  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)]">
          <Server className="h-5 w-5 text-[var(--color-primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Get a Hetzner Cloud API token</h2>
          <p className="text-xs text-muted">
            Hetzner has the cheapest cloud VMs in Europe. ARM cax-* servers start at €3.79/month.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <Step n={1} title="Open Hetzner Cloud Console">
          <ExternalLinkRow href="https://console.hetzner.cloud" label="console.hetzner.cloud" />
        </Step>
        <Step n={2} title="Create or select a project">
          <p className="text-sm">
            Tokens are <strong>per project</strong>. Either pick an existing project or create a
            new one (e.g. <code>vmui</code>).
          </p>
        </Step>
        <Step n={3} title="Generate an API token">
          <p className="text-sm">
            Inside the project: <strong>Security → API Tokens → Generate API Token</strong>. Pick
            <strong> Read &amp; Write</strong> for full lifecycle. Copy the 64-character token —
            shown only once.
          </p>
          <Note>
            Tokens never expire automatically. Rotate them by deleting the old one and creating a
            new one.
          </Note>
        </Step>
        <Step n={4} title="Pick a default location">
          <p className="text-sm">
            <strong>nbg1</strong> (Nuremberg) and <strong>fsn1</strong> (Falkenstein) are the
            cheapest. <strong>ash</strong>/<strong>hil</strong> for North America,{" "}
            <strong>sin</strong> for Asia.
          </p>
        </Step>
        <Step n={5} title="Paste it">
          <p className="text-sm">
            Switch to the <strong>API token</strong> tab. vmui verifies the token by calling
            /servers and stores an encrypted copy locally.
          </p>
        </Step>
      </CardContent>
    </Card>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-primary)_18%,transparent)] text-xs font-semibold text-[var(--color-primary)]">
        {n}
      </div>
      <div className="flex-1 space-y-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="space-y-2 text-sm text-muted">{children}</div>
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md bg-[color-mix(in_oklch,var(--color-warning)_15%,transparent)] p-2 text-xs">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
      <span>{children}</span>
    </div>
  );
}

function ExternalLinkRow({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-mono text-[var(--color-primary)] hover:underline"
    >
      <ExternalLink className="h-3 w-3" /> {label}
    </a>
  );
}
