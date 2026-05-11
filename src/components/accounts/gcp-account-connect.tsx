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
import { addGcpAccount, type GcpAccountFormState } from "@/server/actions/accounts";

const ZONES = [
  "us-central1-a",
  "us-central1-b",
  "us-east1-b",
  "us-east4-a",
  "us-west1-a",
  "us-west2-a",
  "europe-west1-b",
  "europe-west2-a",
  "europe-west3-a",
  "europe-west4-a",
  "asia-northeast1-a",
  "asia-southeast1-a",
];

const initial: GcpAccountFormState = {};

export function GcpAccountConnect() {
  return (
    <Tabs defaultValue="sa" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="sa">
          <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Service-account JSON
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Guided setup
        </TabsTrigger>
      </TabsList>
      <TabsContent value="sa">
        <ServiceAccountPanel />
      </TabsContent>
      <TabsContent value="help">
        <GuidedPanel />
      </TabsContent>
    </Tabs>
  );
}

function ServiceAccountPanel() {
  const [state, action, pending] = useActionState(addGcpAccount, initial);
  const router = useRouter();
  const [zone, setZone] = useState("us-central1-a");

  useEffect(() => {
    if (state.ok && state.accountId) {
      toast.success("GCP project connected");
      router.push("/");
      router.refresh();
    } else if (state.error && !state.fieldErrors) {
      toast.error(state.error);
    }
  }, [state, router]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <h2 className="text-lg font-semibold">Connect with a service-account key</h2>
        <p className="text-xs text-muted">
          Create a service account in IAM with the Compute Viewer (or Compute Admin for actions) role, then
          download a JSON key. Encrypted locally with AES-256-GCM.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" name="name" placeholder="My GCP project" required />
            {state.fieldErrors?.name && <p className="text-xs text-[var(--color-danger)]">{state.fieldErrors.name}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="keyJson">Service-account key JSON</Label>
            <textarea
              id="keyJson"
              name="keyJson"
              required
              spellCheck={false}
              placeholder={`{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key_id": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n",\n  "client_email": "vmui@my-project.iam.gserviceaccount.com",\n  ...\n}`}
              rows={10}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
            />
            <p className="text-xs text-muted">
              Paste the entire JSON file. The <code>project_id</code> field determines which GCP project we connect to.
            </p>
            {state.fieldErrors?.keyJson && <p className="text-xs text-[var(--color-danger)]">{state.fieldErrors.keyJson}</p>}
          </div>
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
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
            {state.fieldErrors?.defaultZone && (
              <p className="text-xs text-[var(--color-danger)]">{state.fieldErrors.defaultZone}</p>
            )}
          </div>
          <Button type="submit" disabled={pending} size="lg">
            {pending ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Verifying with Google Cloud…</>
            ) : (
              <><ShieldCheck className="h-4 w-4" /> Verify &amp; connect</>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
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
          <h2 className="text-lg font-semibold">Create a GCP service account</h2>
          <p className="text-xs text-muted">A JSON key file is all vmui needs.</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <pre className="overflow-auto rounded-md bg-[var(--color-bg-muted)] p-3 text-xs">
{`gcloud config set project <PROJECT_ID>
gcloud iam service-accounts create vmui-reader \\
  --display-name "vmui reader"
gcloud projects add-iam-policy-binding <PROJECT_ID> \\
  --member "serviceAccount:vmui-reader@<PROJECT_ID>.iam.gserviceaccount.com" \\
  --role "roles/compute.viewer"
gcloud iam service-accounts keys create vmui-key.json \\
  --iam-account vmui-reader@<PROJECT_ID>.iam.gserviceaccount.com`}
        </pre>
        <p className="text-xs text-muted">
          Use <code>roles/compute.instanceAdmin.v1</code> instead of <code>compute.viewer</code> if you want vmui
          to start/stop/reboot VMs.
        </p>
        <a
          href="https://cloud.google.com/iam/docs/service-accounts-create"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline"
        >
          Google Cloud docs <ExternalLink className="h-3 w-3" />
        </a>
      </CardContent>
    </Card>
  );
}
