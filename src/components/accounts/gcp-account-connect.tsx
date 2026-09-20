"use client";

import { Field, Textarea } from "@/components/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addGcpAccount, type GcpAccountFormState } from "@/server/actions/accounts";
import { Cloud, HelpCircle, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeBlock, ConnectField, ConnectPanel, ConnectSelect, ExternalLinkRow, RICH, SubmitButton } from "./connect-shared";

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
  const t = useTranslations("cloud.connect.gcp");
  return (
    <Tabs defaultValue="sa" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="sa">
          <KeyRound className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.sa")}
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.help")}
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
  const t = useTranslations("cloud.connect.gcp");
  const tp = useTranslations("cloud.shared.provider");
  const [state, action, pending] = useActionState(addGcpAccount, initial);
  const router = useRouter();
  const [zone, setZone] = useState("us-central1-a");

  useEffect(() => {
    if (state.ok && state.accountId) {
      toast.success(t("connected"));
      router.push("/");
      router.refresh();
    } else if (state.error && !state.fieldErrors) {
      toast.error(state.error);
    }
  }, [state, router, t]);

  return (
    <ConnectPanel title={t("sa.title")} description={t("sa.description")}>
      <form action={action} className="grid gap-4">
        <ConnectField name="name" label={t("sa.name")} placeholder={t("sa.namePlaceholder")} error={state.fieldErrors?.name} required />
        <Field label={t("sa.keyJson")} hint={state.fieldErrors?.keyJson ? <span className="text-danger">{state.fieldErrors.keyJson}</span> : t.rich("sa.keyJsonHint", RICH)}>
          <Textarea
            name="keyJson"
            required
            spellCheck={false}
            placeholder={`{\n  "type": "service_account",\n  "project_id": "...",\n  "private_key_id": "...",\n  "private_key": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n",\n  "client_email": "vmui@my-project.iam.gserviceaccount.com",\n  ...\n}`}
            rows={10}
            className="font-mono text-xs"
          />
        </Field>
        <ConnectSelect
          name="defaultZone"
          label={t("sa.defaultZone")}
          value={zone}
          onValueChange={setZone}
          error={state.fieldErrors?.defaultZone}
          options={ZONES.map((z) => ({ value: z, label: z }))}
        />
        <SubmitButton pending={pending} provider={tp("gcp")} />
      </form>
    </ConnectPanel>
  );
}

function GuidedPanel() {
  const t = useTranslations("cloud.connect.gcp");
  return (
    <ConnectPanel icon={<Cloud />} title={t("guide.title")} description={t("guide.description")}>
      <div className="space-y-3 text-sm">
        <CodeBlock
          code={`gcloud config set project <PROJECT_ID>
gcloud iam service-accounts create vmui-reader \\
  --display-name "vmui reader"
gcloud projects add-iam-policy-binding <PROJECT_ID> \\
  --member "serviceAccount:vmui-reader@<PROJECT_ID>.iam.gserviceaccount.com" \\
  --role "roles/compute.viewer"
gcloud iam service-accounts keys create vmui-key.json \\
  --iam-account vmui-reader@<PROJECT_ID>.iam.gserviceaccount.com`}
        />
        <p className="text-xs text-muted">{t.rich("guide.outro", RICH)}</p>
        <ExternalLinkRow href="https://cloud.google.com/iam/docs/service-accounts-create" label={t("guide.docs")} />
      </div>
    </ConnectPanel>
  );
}
