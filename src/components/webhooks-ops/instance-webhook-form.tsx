"use client";

import { Button, Field, Input } from "@/components/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { ok } from "@/lib/action-result";
import { upsertInstanceWebhookAction } from "@/server/actions/extras";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

const ALL = "__all__";

interface Draft {
  url: string;
  secret: string;
  accountId: string;
  providerInstanceId: string;
}

const EMPTY: Draft = { url: "", secret: "", accountId: ALL, providerInstanceId: "" };

export function InstanceWebhookForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const t = useTranslations("ops.webhooks");
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const create = useAction(
    async (d: Draft) => {
      await upsertInstanceWebhookAction({
        url: d.url,
        secret: d.secret || null,
        accountId: d.accountId === ALL ? null : d.accountId,
        providerInstanceId: d.providerInstanceId || null,
        enabled: true,
      });
      return ok();
    },
    { success: t("created"), onSuccess: () => setDraft(EMPTY) },
  );

  const canSave = draft.url.trim().length > 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void create.run(draft);
      }}
    >
      <Field label={t("fields.url")} hint={t("fields.urlHint")}>
        <Input
          type="url"
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          placeholder="https://example.com/hook"
          maxLength={2048}
          required
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("fields.secret")} hint={t("fields.secretHint")}>
          <Input
            type="password"
            autoComplete="off"
            value={draft.secret}
            onChange={(e) => setDraft({ ...draft, secret: e.target.value })}
            maxLength={512}
          />
        </Field>
        <Field label={t("fields.account")} hint={t("fields.accountHint")}>
          <Select value={draft.accountId} onValueChange={(v) => setDraft({ ...draft, accountId: v })}>
            <SelectTrigger aria-label={t("fields.account")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("scopeAllAccounts")}</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label={t("fields.instance")} hint={t("fields.instanceHint")}>
        <Input
          value={draft.providerInstanceId}
          onChange={(e) => setDraft({ ...draft, providerInstanceId: e.target.value })}
          className="font-mono"
          placeholder="i-0123456789abcdef0"
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={create.pending} disabled={!canSave}>
          <Plus className="size-4" aria-hidden /> {t("add")}
        </Button>
      </div>
    </form>
  );
}
