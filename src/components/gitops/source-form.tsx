"use client";

import { toResult } from "@/components/settings/adapt";
import { Button, Field, Input, Subsection, Textarea } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { createGitSourceAction } from "@/server/actions/gitops";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { InstanceLite } from "./types";

type AuthType = "none" | "token" | "ssh";
const NONE_TARGET = "__none__";

export function SourceForm({ instances, onSaved, onCancel }: { instances: InstanceLite[]; onSaved: () => void; onCancel: () => void }) {
  const t = useTranslations("ops.gitops");
  const tc = useTranslations("common");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [form, setForm] = useState({
    name: "",
    url: "",
    branch: "main",
    token: "",
    sshKey: "",
    username: "",
    composeGlob: "**/docker-compose.y*ml",
    targetInstanceId: instances[0]?.id ?? "",
    pollSeconds: 60,
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value;
    setForm((s) => ({ ...s, [k]: k === "pollSeconds" ? Number(v) : v }));
  };

  const create = useAction(async () => toResult(await createGitSourceAction({ ...form, authType })), {
    success: t("form.saved"),
    onSuccess: onSaved,
  });

  return (
    <Subsection title={t("form.title")} hint={t("form.hint")}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Field label={t("form.name")}>
          <Input value={form.name} onChange={set("name")} autoFocus />
        </Field>
        <Field label={t("form.url")} className="sm:col-span-2 xl:col-span-1">
          <Input value={form.url} onChange={set("url")} placeholder="https://github.com/me/stacks.git" className="font-mono" />
        </Field>
        <Field label={t("form.branch")}>
          <Input value={form.branch} onChange={set("branch")} className="font-mono" />
        </Field>
        <Field label={t("form.auth")}>
          <Select value={authType} onValueChange={(v) => setAuthType(v as AuthType)}>
            <SelectTrigger aria-label={t("form.auth")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("form.authNone")}</SelectItem>
              <SelectItem value="token">{t("form.authToken")}</SelectItem>
              <SelectItem value="ssh">{t("form.authSsh")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {authType === "token" && (
          <>
            <Field label={t("form.username")}>
              <Input value={form.username} onChange={set("username")} className="font-mono" autoComplete="off" />
            </Field>
            <Field label={t("form.token")}>
              <Input type="password" value={form.token} onChange={set("token")} className="font-mono" autoComplete="off" />
            </Field>
          </>
        )}
        {authType === "ssh" && (
          <Field label={t("form.sshKey")} className="sm:col-span-2 xl:col-span-3">
            <Textarea value={form.sshKey} onChange={set("sshKey")} rows={6} className="font-mono text-xs" spellCheck={false} />
          </Field>
        )}
        <Field label={t("form.composeGlob")}>
          <Input value={form.composeGlob} onChange={set("composeGlob")} className="font-mono" />
        </Field>
        <Field label={t("form.target")} hint={t("form.targetHint")}>
          <Select
            value={form.targetInstanceId || NONE_TARGET}
            onValueChange={(v) => setForm((s) => ({ ...s, targetInstanceId: v === NONE_TARGET ? "" : v }))}
          >
            <SelectTrigger aria-label={t("form.target")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE_TARGET}>{t("form.targetNone")}</SelectItem>
              {instances.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name ?? i.providerInstanceId} · {i.provider}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("form.pollSeconds")}>
          <Input type="number" min={15} max={86400} value={form.pollSeconds} onChange={set("pollSeconds")} className="font-mono" />
        </Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button onClick={() => void create.run()} loading={create.pending} disabled={!form.name || !form.url}>
          <Plus className="size-4" aria-hidden />
          {t("form.submit")}
        </Button>
      </div>
    </Subsection>
  );
}
