"use client";

import { Button, Checkbox, Field, PageSection } from "@/components/ui";
import { exportBackup, importBackup } from "@/server/actions/backup";
import { Download, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

export function BackupCard() {
  const t = useTranslations("settings.data.backup");
  const [pending, start] = useTransition();
  const [overwrite, setOverwrite] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileId = useId();

  const doExport = () => {
    start(async () => {
      const r = await exportBackup();
      const blob = new Blob([JSON.stringify({ payload: r.json, signature: r.signature }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vmui-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("exported"));
    });
  };

  const doImport = (file: File) => {
    start(async () => {
      const text = await file.text();
      let outer: { payload: string; signature: string };
      try {
        outer = JSON.parse(text) as typeof outer;
      } catch {
        toast.error(t("notBackup"));
        return;
      }
      const res = await importBackup({
        json: outer.payload,
        signature: outer.signature,
        overwrite,
      });
      if (res.error) toast.error(res.error);
      else toast.success(t("restored", { accounts: res.accounts, keys: res.sshKeys }));
    });
  };

  return (
    <PageSection
      title={t("title")}
      description={t("description")}
      action={
        <Button size="sm" onClick={doExport} loading={pending}>
          <Download className="size-4" aria-hidden /> {t("export")}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("restore")} hint={t("restoreHint")}>
          <input
            ref={fileRef}
            id={fileId}
            type="file"
            accept="application/json"
            disabled={pending}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) doImport(f);
              e.currentTarget.value = "";
            }}
            className="sr-only"
          />
          <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} loading={pending} className="w-full sm:w-auto">
            <Upload className="size-4" aria-hidden /> {t("restore")}
          </Button>
        </Field>
        <Field inline label={t("overwrite")} hint={t("overwriteHint")}>
          <Checkbox checked={overwrite} onCheckedChange={setOverwrite} disabled={pending} />
        </Field>
      </div>
    </PageSection>
  );
}
