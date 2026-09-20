"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addAzureAccount, type AzureAccountFormState } from "@/server/actions/accounts";
import { Cloud, HelpCircle, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { CodeBlock, ConnectField, ConnectPanel, ConnectSelect, ExternalLinkRow, RICH, SubmitButton } from "./connect-shared";

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
  const t = useTranslations("cloud.connect.azure");
  return (
    <Tabs defaultValue="sp" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="sp">
          <KeyRound className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.sp")}
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.help")}
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
  const t = useTranslations("cloud.connect.azure");
  const tp = useTranslations("cloud.shared.provider");
  const [state, action, pending] = useActionState(addAzureAccount, initial);
  const router = useRouter();
  const [location, setLocation] = useState("westeurope");

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
    <ConnectPanel title={t("sp.title")} description={t("sp.description")}>
      <form action={action} className="grid gap-4">
        <ConnectField name="name" label={t("sp.name")} placeholder={t("sp.namePlaceholder")} error={state.fieldErrors?.name} required />
        <ConnectField name="tenantId" label={t("sp.tenantId")} placeholder="00000000-0000-0000-0000-000000000000" error={state.fieldErrors?.tenantId} required />
        <ConnectField name="subscriptionId" label={t("sp.subscriptionId")} placeholder="00000000-0000-0000-0000-000000000000" error={state.fieldErrors?.subscriptionId} required />
        <ConnectField name="clientId" label={t("sp.clientId")} placeholder="00000000-0000-0000-0000-000000000000" error={state.fieldErrors?.clientId} required />
        <ConnectField name="clientSecret" label={t("sp.clientSecret")} type="password" autoComplete="off" error={state.fieldErrors?.clientSecret} required />
        <ConnectSelect
          name="defaultLocation"
          label={t("sp.defaultLocation")}
          value={location}
          onValueChange={setLocation}
          error={state.fieldErrors?.defaultLocation}
          options={LOCATIONS.map((l) => ({ value: l, label: l }))}
        />
        <SubmitButton pending={pending} provider={tp("azure")} />
      </form>
    </ConnectPanel>
  );
}

function GuidedPanel() {
  const t = useTranslations("cloud.connect.azure");
  return (
    <ConnectPanel icon={<Cloud />} title={t("guide.title")} description={t("guide.description")}>
      <div className="space-y-3 text-sm">
        <p>{t("guide.intro")}</p>
        <CodeBlock
          code={`az login
az account set --subscription <SUBSCRIPTION_ID>
az ad sp create-for-rbac \\
  --name "vmui-readonly" \\
  --role "Contributor" \\
  --scopes /subscriptions/<SUBSCRIPTION_ID>`}
        />
        <p className="text-xs text-muted">{t.rich("guide.outro", RICH)}</p>
        <ExternalLinkRow href="https://learn.microsoft.com/azure/active-directory/develop/howto-create-service-principal-portal" label={t("guide.docs")} />
      </div>
    </ConnectPanel>
  );
}
