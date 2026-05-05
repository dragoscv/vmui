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
  Copy,
  CheckCircle2,
  Apple,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { addScalewayAccount, type ScalewayAccountFormState } from "@/server/actions/accounts";

const ZONES = [
  { id: "fr-par-1", label: "Paris 1 — M2 / M2-Pro / M4" },
  { id: "fr-par-3", label: "Paris 3 — M1 only" },
];

const initial: ScalewayAccountFormState = {};

export function ScalewayAccountConnect() {
  return (
    <Tabs defaultValue="keys" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="keys">
          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> API key
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Guided setup
        </TabsTrigger>
      </TabsList>
      <TabsContent value="keys">
        <ApiKeyPanel />
      </TabsContent>
      <TabsContent value="help">
        <GuidedPanel />
      </TabsContent>
    </Tabs>
  );
}

function ApiKeyPanel() {
  const [state, action, pending] = useActionState(addScalewayAccount, initial);
  const router = useRouter();
  const [zone, setZone] = useState("fr-par-1");

  if (state.ok && state.accountId) {
    toast.success("Scaleway account connected");
    router.push("/");
    router.refresh();
  } else if (state.error && !state.fieldErrors) {
    // toast errors that aren't field-specific
    toast.error(state.error);
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <h2 className="text-lg font-semibold">Connect with API secret key</h2>
        <p className="text-xs text-muted">
          Generate an IAM API key in the Scaleway console. Credentials are encrypted with AES-256-GCM and stored
          locally.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <Field
            name="name"
            label="Display name"
            placeholder="dragoscims (Scaleway)"
            description="Shown in vmui — does not need to match your Scaleway project name."
            error={state.fieldErrors?.name}
            required
          />
          <Field
            name="secretKey"
            label="Secret key"
            placeholder="11111111-2222-3333-4444-555555555555"
            description="UUID-format secret from Console → IAM → API Keys → Create API key."
            error={state.fieldErrors?.secretKey}
            required
            type="password"
            autoComplete="off"
          />
          <Field
            name="projectId"
            label="Project ID"
            placeholder="11111111-2222-3333-4444-555555555555"
            description="From Console → Project dashboard → 'Project ID' button at the top right."
            error={state.fieldErrors?.projectId}
            required
          />
          <div className="grid gap-1.5">
            <Label htmlFor="defaultZone">Default zone</Label>
            <select
              id="defaultZone"
              name="defaultZone"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {ZONES.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">
              Apple Silicon is only available in Paris. Pick fr-par-1 unless you specifically want a Mac mini M1.
            </p>
            {state.fieldErrors?.defaultZone && (
              <p className="text-xs text-[var(--color-danger)]">{state.fieldErrors.defaultZone}</p>
            )}
          </div>
          <Button type="submit" disabled={pending} size="lg">
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Verifying with Scaleway…
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

// ====================================================================

function GuidedPanel() {
  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)]">
          <Apple className="h-5 w-5 text-[var(--color-primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Get a Scaleway API key for Apple Silicon</h2>
          <p className="text-xs text-muted">
            Scaleway runs real Mac minis (M1 / M2 / M2-Pro / M4) in Paris with hourly billing after the 24h Apple
            minimum.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <Step n={1} title="Create / sign in to a Scaleway account">
          <p className="text-sm">
            Open the console and either sign up or sign in.
          </p>
          <ExternalLinkRow href="https://console.scaleway.com" label="console.scaleway.com" />
        </Step>

        <Step n={2} title="Find your Project ID">
          <p className="text-sm">
            On the Console homepage, your <code>Default</code> project is shown. Click it (or any other project) →
            top-right shows a <strong>Project ID</strong> button. Click to copy.
          </p>
          <ExternalLinkRow
            href="https://console.scaleway.com/project/settings"
            label="Project settings"
          />
        </Step>

        <Step n={3} title="Create an API key">
          <p className="text-sm">
            Go to <strong>IAM → API Keys → Create API key</strong>. Bearer:{" "}
            <strong>your IAM user (yourself)</strong>. Tick <strong>"Use this API key for the default project"</strong>.
            Copy the <strong>Secret key</strong> shown <em>once</em>.
          </p>
          <ExternalLinkRow
            href="https://console.scaleway.com/iam/api-keys"
            label="IAM → API Keys"
          />
          <Note>
            You only see the secret once — save it to a password manager. If you lose it, just generate another key.
          </Note>
        </Step>

        <Step n={4} title="Permissions vmui needs">
          <p className="text-sm">
            For full functionality, grant the IAM user the <strong>AppleSiliconFullAccess</strong> permission set.
            For read-only sync, <strong>AppleSiliconReadOnly</strong> is enough.
          </p>
        </Step>

        <Step n={5} title="Paste them in the API key tab">
          <p className="text-sm">
            Switch back to the <strong>API key</strong> tab and paste the Secret key + Project ID. vmui will verify
            them and store an encrypted copy locally.
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

// avoid unused-import warnings (Copy reserved for future copy-buttons)
void Copy;
