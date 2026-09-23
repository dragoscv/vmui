"use client";

import { Alert, Badge, Button, Field, Input, PageSection } from "@/components/ui";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import type { CodaiSettingsPublic } from "@/lib/codai/settings";
import { clearCodaiApiKeyAction, saveCodaiSettingsAction, testCodaiConnectionAction } from "@/server/actions/codai";
import { Bot, KeyRound, Save, ShieldCheck, Trash2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export function CodaiCard({ initial }: { initial: CodaiSettingsPublic }) {
  const t = useTranslations("settings.integrations.codai");
  const tc = useTranslations("common");
  const confirm = useConfirm();
  const [state, setState] = useState(initial);
  const [gatewayUrl, setGatewayUrl] = useState(initial.gatewayUrl);
  const [apiKey, setApiKey] = useState("");

  const save = useAction(
    async () => {
      const r = await saveCodaiSettingsAction({ gatewayUrl: gatewayUrl.trim(), apiKey: apiKey.trim() || undefined });
      if (!r.ok) return r;
      setState(r.data);
      setApiKey("");
      return ok();
    },
    { success: t("saved"), refresh: false },
  );

  const test = useAction(
    async () => {
      const r = await testCodaiConnectionAction();
      return r.ok ? ok(r.data.projects) : r;
    },
    { success: (n) => t("testOk", { count: n }), refresh: false },
  );

  const clear = useAction(
    async () => {
      const r = await clearCodaiApiKeyAction();
      if (!r.ok) return r;
      setState((s) => ({ ...s, configured: false, apiKeyPrefix: null, apiKeyLength: null }));
      return ok();
    },
    { success: t("cleared"), refresh: false },
  );

  async function onClear() {
    const yes = await confirm({ title: t("clearConfirm"), description: t("clearHint"), tone: "danger", confirmText: tc("delete") });
    if (yes) await clear.run();
  }

  return (
    <PageSection
      title={t("title")}
      description={t("description")}
      action={
        state.configured ? (
          <Badge variant="success">
            <ShieldCheck className="size-3" aria-hidden /> {t("configured")}
          </Badge>
        ) : (
          <Badge variant="muted">{t("notConfigured")}</Badge>
        )
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
      >
        <Alert tone="info" icon={<Bot />} className="text-xs">
          {t.rich("intro", { code: (c) => <code className="rounded bg-bg-muted px-1 font-mono">{c}</code> })}
        </Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("gatewayUrl")} hint={t("gatewayUrlHint")}>
            <Input value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} type="url" className="font-mono text-xs" required />
          </Field>
          <Field label={t("apiKey")} hint={state.configured && state.apiKeyPrefix ? t("apiKeyStored", { prefix: state.apiKeyPrefix, length: state.apiKeyLength ?? 0 }) : t("apiKeyHint")}>
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 shrink-0 text-fg-muted" aria-hidden />
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={state.configured ? t("apiKeyReplace") : "codai_…"}
                className="font-mono text-xs"
              />
            </div>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={save.pending}>
            <Save className="size-4" aria-hidden /> {tc("save")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void test.run()} loading={test.pending} disabled={!state.configured}>
            <Zap className="size-4" aria-hidden /> {t("test")}
          </Button>
          {state.configured && (
            <Button type="button" size="sm" variant="ghost" onClick={() => void onClear()} disabled={clear.pending}>
              <Trash2 className="size-4 text-danger" aria-hidden /> {t("clear")}
            </Button>
          )}
        </div>
      </form>
    </PageSection>
  );
}
