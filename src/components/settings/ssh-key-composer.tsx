"use client";

import { Alert, Button, Field, Input, PageSection, Textarea } from "@/components/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    generateSshKeyAction,
    importSshKeyAction,
    type GenerateSshKeyState,
    type ImportSshKeyState,
} from "@/server/actions/ssh-keys";
import { Check, Copy, Sparkles, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useState } from "react";
import { toast } from "sonner";

const initImport: ImportSshKeyState = {};
const initGen: GenerateSshKeyState = {};

export function SshKeyComposer({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations("settings.access.sshKeys");
  const [imp, importAct, importPending] = useActionState(importSshKeyAction, initImport);
  const [gen, generateAct, genPending] = useActionState(generateSshKeyAction, initGen);
  const [copied, setCopied] = useState(false);
  const ids = useId();

  useEffect(() => {
    if (imp.ok) onChanged?.();
    if (imp.error) toast.error(imp.error);
  }, [imp, onChanged]);

  useEffect(() => {
    if (gen.ok) onChanged?.();
    if (gen.error) toast.error(gen.error);
  }, [gen, onChanged]);

  const copyKey = async () => {
    if (!gen.publicKey) return;
    await navigator.clipboard.writeText(gen.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <PageSection title={t("addTitle")}>
      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="import" className="gap-1.5">
            <Upload className="size-4" aria-hidden /> {t("import")}
          </TabsTrigger>
          <TabsTrigger value="generate" className="gap-1.5">
            <Sparkles className="size-4" aria-hidden /> {t("generate")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="pt-4">
          <form action={importAct} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("name")}>
                <Input id={`${ids}-name`} name="name" required placeholder={t("namePlaceholder")} />
              </Field>
              <Field label={`${t("passphrase")} (${t("optional")})`}>
                <Input id={`${ids}-pass`} name="passphrase" type="password" autoComplete="off" />
              </Field>
            </div>
            <Field label={t("publicKey")}>
              <Textarea name="publicKey" rows={2} required placeholder={t("publicKeyPlaceholder")} className="font-mono text-xs" spellCheck={false} />
            </Field>
            <Field label={`${t("privateKey")} (${t("optional")})`} hint={t("privateKeyHint")}>
              <Textarea name="privateKey" rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className="font-mono text-[11px]" spellCheck={false} />
            </Field>
            <Button type="submit" loading={importPending} className="justify-self-start">
              {t("save")}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="generate" className="pt-4">
          <form action={generateAct} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("name")}>
                <Input id={`${ids}-gname`} name="name" required placeholder={t("generateNamePlaceholder")} />
              </Field>
              <Field label={t("algorithm")}>
                <select
                  name="algo"
                  defaultValue="ed25519"
                  aria-label={t("algorithm")}
                  className="flex h-9 w-full rounded-[var(--radius-md)] border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="ed25519">{t("algoEd25519")}</option>
                  <option value="rsa">{t("algoRsa")}</option>
                </select>
              </Field>
              <Field label={`${t("passphrase")} (${t("optional")})`}>
                <Input id={`${ids}-gpass`} name="passphrase" type="password" autoComplete="off" />
              </Field>
            </div>
            <Button type="submit" loading={genPending} className="justify-self-start">
              <Sparkles className="size-4" aria-hidden /> {t("generateAction")}
            </Button>
            {gen.publicKey && (
              <Alert
                tone="success"
                title={t("generatedTitle")}
                action={
                  <Button type="button" size="sm" variant="outline" onClick={() => void copyKey()} aria-label={t("copyPublic")}>
                    {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                    {copied ? t("copied") : t("copyPublic")}
                  </Button>
                }
              >
                <p>{t("generatedHint")}</p>
                <code className="mt-2 block break-all font-mono text-xs text-fg">{gen.publicKey}</code>
              </Alert>
            )}
          </form>
        </TabsContent>
      </Tabs>
    </PageSection>
  );
}
