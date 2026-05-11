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
  Droplets,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  addDigitalOceanAccount,
  type DigitalOceanAccountFormState,
} from "@/server/actions/accounts";
import { regionsFor } from "@/lib/providers/regions";

const initial: DigitalOceanAccountFormState = {};

export function DigitalOceanAccountConnect() {
  return (
    <Tabs defaultValue="token" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="token">
          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Personal Access Token
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
  const [state, action, pending] = useActionState(addDigitalOceanAccount, initial);
  const router = useRouter();
  const [region, setRegion] = useState("nyc3");
  const regions = regionsFor("digitalocean");

  if (state.ok && state.accountId) {
    toast.success("DigitalOcean account connected");
    router.push("/");
    router.refresh();
  } else if (state.error && !state.fieldErrors) {
    toast.error(state.error);
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <h2 className="text-lg font-semibold">Connect with a Personal Access Token</h2>
        <p className="text-xs text-muted">
          Create a token in the DigitalOcean console with <strong>read &amp; write</strong> scopes.
          The token is encrypted with AES-256-GCM and stored locally.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <Field
            name="name"
            label="Display name"
            placeholder="dragos (DigitalOcean)"
            description="Shown in vmui. Does not need to match your DO team name."
            error={state.fieldErrors?.name}
            required
          />
          <Field
            name="token"
            label="Personal Access Token"
            placeholder="dop_v1_…"
            description="From Console → API → Tokens/Keys → Generate New Token. Read+Write recommended."
            error={state.fieldErrors?.token}
            required
            type="password"
            autoComplete="off"
          />
          <div className="grid gap-1.5">
            <Label htmlFor="defaultRegion">Default region</Label>
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
                <Loader2 className="h-4 w-4 animate-spin" /> Verifying with DigitalOcean…
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
          <Droplets className="h-5 w-5 text-[var(--color-primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Get a DigitalOcean PAT</h2>
          <p className="text-xs text-muted">
            DigitalOcean droplets, volumes, snapshots, firewalls, floating IPs, VPCs, load
            balancers, managed databases, Spaces, and DOKS all surface in vmui.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <Step n={1} title="Open the DigitalOcean console">
          <ExternalLinkRow href="https://cloud.digitalocean.com" label="cloud.digitalocean.com" />
        </Step>
        <Step n={2} title="Create a new Personal Access Token">
          <p className="text-sm">
            Navigate to <strong>API → Tokens/Keys → Generate New Token</strong>. Give it a name
            (e.g. <code>vmui</code>), set an expiration (90 days is a sensible default), and tick
            both <strong>Read</strong> and <strong>Write</strong> scopes for full lifecycle.
          </p>
          <ExternalLinkRow
            href="https://cloud.digitalocean.com/account/api/tokens"
            label="API → Tokens/Keys"
          />
          <Note>
            If you only want vmui to observe (no power on/off, no create), uncheck Write.
          </Note>
        </Step>
        <Step n={3} title="Copy the token (shown once)">
          <p className="text-sm">
            DO displays the token <em>once</em>. Copy it before closing the dialog. If you lose it,
            generate a new one — old tokens can be revoked from the same page.
          </p>
        </Step>
        <Step n={4} title="Pick a default region">
          <p className="text-sm">
            Choose the region you most often use. You can add more regions later from the account
            page (vmui syncs all of them in parallel).
          </p>
        </Step>
        <Step n={5} title="Paste the token">
          <p className="text-sm">
            Switch back to the <strong>Personal Access Token</strong> tab and paste the value.
            vmui will verify it and store an encrypted copy locally.
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
