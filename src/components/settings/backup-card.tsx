"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, Upload, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { exportBackup, importBackup } from "@/server/actions/backup";

export function BackupCard() {
  const [pending, start] = useTransition();
  const [overwrite, setOverwrite] = useState(false);

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
      toast.success("Backup downloaded");
    });
  };

  const doImport = (file: File) => {
    start(async () => {
      const text = await file.text();
      let outer: { payload: string; signature: string };
      try {
        outer = JSON.parse(text) as typeof outer;
      } catch {
        toast.error("Not a vmui backup file");
        return;
      }
      const res = await importBackup({
        json: outer.payload,
        signature: outer.signature,
        overwrite,
      });
      if (res.error) toast.error(res.error);
      else toast.success(`Restored ${res.accounts} accounts, ${res.sshKeys} keys`);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Download className="h-4 w-4" /> Backup &amp; restore
        </CardTitle>
        <CardDescription>
          Signed JSON of all accounts and SSH keys. Credentials remain encrypted with your master key — restore on the
          same key on another host to migrate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={doExport} disabled={pending}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export backup
          </Button>
          <Label className="ml-2 inline-flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.currentTarget.checked)}
            />
            Overwrite existing rows on import
          </Label>
        </div>
        <div>
          <Label htmlFor="restore" className="text-xs text-muted">
            Restore from file
          </Label>
          <input
            id="restore"
            type="file"
            accept="application/json"
            disabled={pending}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (f) doImport(f);
              e.currentTarget.value = "";
            }}
            className="mt-1 block w-full text-sm file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-[var(--color-bg-muted)] file:px-3 file:py-1.5 file:text-sm hover:file:bg-[var(--color-surface)]"
          />
          <Upload className="hidden" />
        </div>
      </CardContent>
    </Card>
  );
}
