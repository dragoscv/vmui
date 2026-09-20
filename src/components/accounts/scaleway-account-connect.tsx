"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addScalewayAccount, type ScalewayAccountFormState } from "@/server/actions/accounts";
import { Apple, HelpCircle, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConnectField, ConnectPanel, ConnectSelect, ExternalLinkRow, Note, RICH, Step, SubmitButton } from "./connect-shared";

const ZONE_IDS = ["fr-par-1", "fr-par-3"] as const;

const initial: ScalewayAccountFormState = {};

export function ScalewayAccountConnect() {
  const t = useTranslations("cloud.connect.scaleway");
  return (
    <Tabs defaultValue="keys" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="keys">
          <KeyRound className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.keys")}
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.help")}
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
  const t = useTranslations("cloud.connect.scaleway");
  const tp = useTranslations("cloud.shared.provider");
  const [state, action, pending] = useActionState(addScalewayAccount, initial);
  const router = useRouter();
  const [zone, setZone] = useState<string>("fr-par-1");

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
    <ConnectPanel title={t("keys.title")} description={t("keys.description")}>
      <form action={action} className="grid gap-4">
        <ConnectField name="name" label={t("keys.name")} placeholder={t("keys.namePlaceholder")} hint={t("keys.nameHint")} error={state.fieldErrors?.name} required />
        <ConnectField
          name="secretKey"
          label={t("keys.secretKey")}
          placeholder="11111111-2222-3333-4444-555555555555"
          hint={t("keys.secretKeyHint")}
          error={state.fieldErrors?.secretKey}
          required
          type="password"
          autoComplete="off"
        />
        <ConnectField
          name="projectId"
          label={t("keys.projectId")}
          placeholder="11111111-2222-3333-4444-555555555555"
          hint={t("keys.projectIdHint")}
          error={state.fieldErrors?.projectId}
          required
        />
        <ConnectSelect
          name="defaultZone"
          label={t("keys.defaultZone")}
          hint={t("keys.defaultZoneHint")}
          value={zone}
          onValueChange={setZone}
          error={state.fieldErrors?.defaultZone}
          options={ZONE_IDS.map((id) => ({ value: id, label: t(`keys.zones.${id}`) }))}
        />
        <SubmitButton pending={pending} provider={tp("scaleway")} />
      </form>
    </ConnectPanel>
  );
}

function GuidedPanel() {
  const t = useTranslations("cloud.connect.scaleway");
  return (
    <ConnectPanel icon={<Apple />} title={t("guide.title")} description={t("guide.description")}>
      <div className="space-y-5">
        <Step n={1} title={t("guide.step1.title")}>
          <p>{t("guide.step1.body")}</p>
          <ExternalLinkRow href="https://console.scaleway.com" label="console.scaleway.com" />
        </Step>
        <Step n={2} title={t("guide.step2.title")}>
          <p>{t.rich("guide.step2.body", RICH)}</p>
          <ExternalLinkRow href="https://console.scaleway.com/project/settings" label={t("guide.step2.link")} />
        </Step>
        <Step n={3} title={t("guide.step3.title")}>
          <p>{t.rich("guide.step3.body", RICH)}</p>
          <ExternalLinkRow href="https://console.scaleway.com/iam/api-keys" label={t("guide.step3.link")} />
          <Note tone="warning">{t("guide.step3.note")}</Note>
        </Step>
        <Step n={4} title={t("guide.step4.title")}>
          <p>{t.rich("guide.step4.body", RICH)}</p>
        </Step>
        <Step n={5} title={t("guide.step5.title")}>
          <p>{t.rich("guide.step5.body", RICH)}</p>
        </Step>
      </div>
    </ConnectPanel>
  );
}
