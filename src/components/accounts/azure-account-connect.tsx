"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, KeyRound, HelpCircle, ExternalLink, Cloud } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { addAzureAccount, type AzureAccountFormState } from "@/server/actions/accounts";

const LOCATIONS = [
  "westeurope",
  "northeurope",
  "eastus",
  "eastus2",
  "westus2",
  "westus3",
  "centralus",
  "uksouth",
  "francecentral",
  "germanywestcentral",
  "swedencentral",
  "japaneast",
  "australiaeast",
  "southeastasia",
];

const initial: AzureAccountFormState = {};

export function AzureAccountConnect() {
  return (
    <Tabs defaultValue="sp" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="sp">
          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Service principal
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Guided setup
        </TabsTrigger>
      </TabsList>
      <TabsContent value="sp">
        <ServicePrincipalPanel />
      </TabsContent>
      <TabsContent value="help">
        <GuidedPanel />
      </TabsContent>
    </Tabs>
  );
}

function ServicePrincipalPanel() {
  const [state, action, pending] = useActionState(addAzureAccount, initial);
  const router = useRouter();
  const [location, setLocation] = useState("westeurope");

  useEffect(() => {
    if (state.ok && state.accountId) {
      toast.success("Azure subscription connected");
      router.push("/");
      router.refresh();
    } else if (state.error && !state.fieldErrors) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <h2 className="text-lg font-semibold">Connect with a service principal</h2>
        <p className="text-xs text-muted">
          Create an app registration with a client secret and grant it Reader (or Contributor for actions) on the
          subscription. Credentials are AES-256-GCM encrypted locally.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <Field name="name" label="Display name" placeholder="My Azure subscription" error={state.fieldErrors?.name} required />
          <Field name="tenantId" label="Tenant ID (Directory)" placeholder="00000000-0000-0000-0000-000000000000" error={state.fieldErrors?.tenantId} required />
          <Field name="subscriptionId" label="Subscription ID" placeholder="00000000-0000-0000-0000-000000000000" error={state.fieldErrors?.subscriptionId} required />
          <Field name="clientId" label="Client (App) ID" placeholder="00000000-0000-0000-0000-000000000000" error={state.fieldErrors?.clientId} required />
          <Field name="clientSecret" label="Client secret" type="password" autoComplete="off" error={state.fieldErrors?.clientSecret} required />
          <div className="grid gap-1.5">
            <Label htmlFor="defaultLocation">Default location</Label>
            <select
              id="defaultLocation"
              name="defaultLocation"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="flex h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            >
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            {state.fieldErrors?.defaultLocation && (
              <p className="text-xs text-[var(--color-danger)]">{state.fieldErrors.defaultLocation}</p>
            )}
          </div>
          <Button type="submit" disabled={pending} size="lg">
            {pending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Verifying with Azure…</>
            ) : (
              <><ShieldCheck className="h-4 w-4" /> Verify &amp; connect</>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  name, label, placeholder, error, required, type = "text", autoComplete,
}: {
  name: string;
  label: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} placeholder={placeholder} required={required} type={type} autoComplete={autoComplete} />
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function GuidedPanel() {
  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_oklch,var(--color-primary)_15%,transparent)]">
          <Cloud className="h-5 w-5 text-[var(--color-primary)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Create an Azure service principal</h2>
          <p className="text-xs text-muted">Headless credentials for vmui — no interactive login needed.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Run in Azure Cloud Shell or with the Azure CLI installed locally:</p>
        <pre className="overflow-auto rounded-md bg-[var(--color-bg-muted)] p-3 text-xs">
{`az login
az account set --subscription <SUBSCRIPTION_ID>
az ad sp create-for-rbac \\
  --name "vmui-readonly" \\
  --role "Contributor" \\
  --scopes /subscriptions/<SUBSCRIPTION_ID>`}
        </pre>
        <p className="text-xs text-muted">
          The CLI prints <code>appId</code> (= client ID), <code>password</code> (= client secret), and
          <code> tenant</code>. Use Reader instead of Contributor if you only want read-only listing.
        </p>
        <a
          href="https://learn.microsoft.com/azure/active-directory/develop/howto-create-service-principal-portal"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
        >
          Microsoft docs <ExternalLink className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  );
}
