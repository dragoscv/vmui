"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { regionsFor } from "@/lib/providers/regions";
import { addDigitalOceanAccount, type DigitalOceanAccountFormState } from "@/server/actions/accounts";
import { Droplets, HelpCircle, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConnectField, ConnectPanel, ConnectSelect, ExternalLinkRow, Note, RICH, Step, SubmitButton } from "./connect-shared";

const initial: DigitalOceanAccountFormState = {};

export function DigitalOceanAccountConnect() {
  const t = useTranslations("cloud.connect.digitalocean");
  return (
    <Tabs defaultValue="token" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="token">
          <KeyRound className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.token")}
        </TabsTrigger>
        <TabsTrigger value="help">
          <HelpCircle className="mr-1.5 size-3.5" aria-hidden /> {t("tabs.help")}
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
  const t = useTranslations("cloud.connect.digitalocean");
  const tp = useTranslations("cloud.shared.provider");
  const [state, action, pending] = useActionState(addDigitalOceanAccount, initial);
  const router = useRouter();
  const [region, setRegion] = useState("nyc3");
  const regions = regionsFor("digitalocean");

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
    <ConnectPanel title={t("token.title")} description={t.rich("token.description", RICH)}>
      <form action={action} className="grid gap-4">
        <ConnectField name="name" label={t("token.name")} placeholder={t("token.namePlaceholder")} hint={t("token.nameHint")} error={state.fieldErrors?.name} required />
        <ConnectField
          name="token"
          label={t("token.token")}
          placeholder="dop_v1_…"
          hint={t("token.tokenHint")}
          error={state.fieldErrors?.token}
          required
          type="password"
          autoComplete="off"
        />
        <ConnectSelect
          name="defaultRegion"
          label={t("token.defaultRegion")}
          value={region}
          onValueChange={setRegion}
          error={state.fieldErrors?.defaultRegion}
          options={regions.map((r) => ({ value: r.id, label: `${r.id} — ${r.label}` }))}
        />
        <SubmitButton pending={pending} provider={tp("digitalocean")} />
      </form>
    </ConnectPanel>
  );
}

function GuidedPanel() {
  const t = useTranslations("cloud.connect.digitalocean");
  return (
    <ConnectPanel icon={<Droplets />} title={t("guide.title")} description={t("guide.description")}>
      <div className="space-y-5">
        <Step n={1} title={t("guide.step1.title")}>
          <ExternalLinkRow href="https://cloud.digitalocean.com" label="cloud.digitalocean.com" />
        </Step>
        <Step n={2} title={t("guide.step2.title")}>
          <p>{t.rich("guide.step2.body", RICH)}</p>
          <ExternalLinkRow href="https://cloud.digitalocean.com/account/api/tokens" label={t("guide.step2.link")} />
          <Note tone="warning">{t("guide.step2.note")}</Note>
        </Step>
        <Step n={3} title={t("guide.step3.title")}>
          <p>{t.rich("guide.step3.body", RICH)}</p>
        </Step>
        <Step n={4} title={t("guide.step4.title")}>
          <p>{t("guide.step4.body")}</p>
        </Step>
        <Step n={5} title={t("guide.step5.title")}>
          <p>{t.rich("guide.step5.body", RICH)}</p>
        </Step>
      </div>
    </ConnectPanel>
  );
}
