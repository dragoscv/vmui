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
import { Field } from "@/components/ui/settings-panel";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { err, ok } from "@/lib/action-result";
import type { InstanceRow } from "@/lib/db/schema";
import { setInstanceNotesAction } from "@/server/actions/instances";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

const MAX = 2000;

export function NotesDialog({
  open,
  onOpenChange,
  instance,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instance: InstanceRow;
}) {
  const t = useTranslations("vm.notes");
  const tc = useTranslations("common");
  const [value, setValue] = useState(instance.notes ?? "");
  const { run, pending } = useAction(
    async (notes: string | null) => {
      const r = await setInstanceNotesAction({ id: instance.id, notes });
      return r.ok ? ok() : err(r.error ?? "common.error");
    },
    { success: t("saved"), onSuccess: () => onOpenChange(false) },
  );

  useEffect(() => {
    if (open) setValue(instance.notes ?? "");
  }, [open, instance.notes]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    void run(value.trim() ? value : null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="my-4">
            <Field
              label={t("label")}
              hint={<span className="block text-right tabular-nums">{t("counter", { count: value.length, max: MAX })}</span>}
            >
              <Textarea
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={6}
                maxLength={MAX}
                placeholder={t("placeholder")}
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
