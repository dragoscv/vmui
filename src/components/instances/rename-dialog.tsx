"use client";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/settings-panel";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import type { InstanceRow } from "@/lib/db/schema";
import { renameInstanceAction } from "@/server/actions/instances";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { instanceLabel } from "./instance-label";

const MAX = 80;

export function RenameInstanceDialog({
  open,
  onOpenChange,
  instance,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instance: InstanceRow;
}) {
  const t = useTranslations("vm.rename");
  const tc = useTranslations("common");
  const [value, setValue] = useState(instance.displayName ?? instance.name ?? "");
  const { run, pending } = useAction(
    async (displayName: string | null) => {
      const r = await renameInstanceAction({ id: instance.id, displayName });
      return r.ok ? ok(displayName) : err(r.error ?? "common.error");
    },
    {
      success: (name) => (name ? t("renamed", { name }) : t("cleared")),
      onSuccess: () => onOpenChange(false),
    },
  );

  useEffect(() => {
    if (open) setValue(instance.displayName ?? instance.name ?? "");
  }, [open, instance.displayName, instance.name]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const next = value.trim();
    void run(next.length === 0 ? null : next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {t.rich("description", {
                current: instanceLabel(instance),
                provider: instance.name ?? "—",
                mono: (c) => <span className="font-mono text-xs">{c}</span>,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="my-4">
            <Field label={t("label")} hint={t("hint", { max: MAX })}>
              <Input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={instance.name ?? instance.providerInstanceId}
                maxLength={MAX}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" loading={pending}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
