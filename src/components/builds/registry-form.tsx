"use client";

import { Button, Field, Input, Subsection, Textarea } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { err, ok, type ActionResult } from "@/lib/action-result";
import { createRegistryAction } from "@/server/actions/builds";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { RegistryType } from "./types";

const REGISTRY_TYPES: readonly RegistryType[] = ["ghcr", "dockerhub", "ecr", "gcr", "acr"];

export function RegistryForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const t = useTranslations("ops.builds");
  const tc = useTranslations("common");
  const [type, setType] = useState<RegistryType>("ghcr");
  const [form, setForm] = useState({
    name: "",
    registryUrl: "ghcr.io",
    username: "",
    password: "",
    token: "",
    accessKeyId: "",
    secretAccessKey: "",
    region: "us-east-1",
    serviceAccountJson: "",
  });

  const setField = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const save = useAction(
    async (): Promise<ActionResult> => {
      try {
        const res = await createRegistryAction({ ...form, type });
        if (!res.ok) return err("common.error");
        onSaved();
        return ok();
      } catch (e) {
        return err(e instanceof Error ? e.message : "common.error");
      }
    },
    { success: t("registries.saved"), refresh: false },
  );

  const usesPassword = type === "ghcr" || type === "dockerhub" || type === "acr";

  return (
    <Subsection title={t("registries.addTitle")} hint={t("registries.addHint")}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label={t("registries.fields.name")}>
          <Input value={form.name} onChange={setField("name")} autoComplete="off" />
        </Field>
        <Field label={t("registries.fields.type")}>
          <Select value={type} onValueChange={(v) => setType(v as RegistryType)}>
            <SelectTrigger aria-label={t("registries.fields.type")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGISTRY_TYPES.map((rt) => (
                <SelectItem key={rt} value={rt}>
                  {t(`registries.types.${rt}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("registries.fields.url")}>
          <Input value={form.registryUrl} onChange={setField("registryUrl")} className="font-mono" autoComplete="off" />
        </Field>
      </div>

      {usesPassword && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("registries.fields.username")}>
            <Input value={form.username} onChange={setField("username")} className="font-mono" autoComplete="off" />
          </Field>
          <Field label={type === "ghcr" ? t("registries.fields.tokenPat") : t("registries.fields.passwordOrToken")}>
            <Input
              type="password"
              value={type === "ghcr" ? form.token : form.password}
              onChange={setField(type === "ghcr" ? "token" : "password")}
              className="font-mono"
              autoComplete="new-password"
            />
          </Field>
        </div>
      )}

      {type === "ecr" && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Field label={t("registries.fields.accessKeyId")}>
            <Input value={form.accessKeyId} onChange={setField("accessKeyId")} className="font-mono" autoComplete="off" />
          </Field>
          <Field label={t("registries.fields.secretAccessKey")}>
            <Input type="password" value={form.secretAccessKey} onChange={setField("secretAccessKey")} className="font-mono" autoComplete="new-password" />
          </Field>
          <Field label={t("registries.fields.region")}>
            <Input value={form.region} onChange={setField("region")} className="font-mono" autoComplete="off" />
          </Field>
        </div>
      )}

      {type === "gcr" && (
        <Field label={t("registries.fields.serviceAccountJson")}>
          <Textarea value={form.serviceAccountJson} onChange={setField("serviceAccountJson")} rows={4} spellCheck={false} className="font-mono text-xs" />
        </Field>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button size="sm" loading={save.pending} disabled={!form.name} onClick={() => void save.run()}>
          <Plus className="size-4" aria-hidden /> {t("registries.save")}
        </Button>
      </div>
    </Subsection>
  );
}
