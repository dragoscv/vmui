"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, Download, RefreshCw, Trash2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  writeLocalBackupAction,
  deleteLocalBackupAction,
  verifyLocalBackupAction,
} from "@/server/actions/local-backup";
import type { BackupFileSummary } from "@/lib/local-backup";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = n / 1024;
  let i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

export function LocalBackupCard({ initialBackups }: { initialBackups: BackupFileSummary[] }) {
  const [backups, setBackups] = useState(initialBackups);
  const [pending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(async () => {
      const res = await fetch("/api/local-backups");
      if (res.ok) setBackups(await res.json());
    });
  };

  const handleCreate = () => {
    startTransition(async () => {
      const out = await writeLocalBackupAction();
      if (out.ok) {
        toast.success(`Backup written: ${out.file?.name ?? ""}`);
        refresh();
      } else {
        toast.error(out.error ?? "Backup failed");
      }
    });
  };

  const handleVerify = (name: string) => {
    startTransition(async () => {
      const out = await verifyLocalBackupAction({ name });
      if (out.ok) {
        const counts = Object.entries(out.counts ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(" · ");
        toast.success(`Verified: ${counts}`);
      } else {
        toast.error(out.error ?? "Verify failed");
      }
    });
  };

  const handleDelete = (name: string) => {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    startTransition(async () => {
      const out = await deleteLocalBackupAction({ name });
      if (out.ok) {
        toast.success("Backup deleted");
        refresh();
      } else {
        toast.error(out.error ?? "Delete failed");
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Archive className="h-4 w-4" /> Local encrypted backups
          </h2>
          <p className="text-xs text-muted">
            AES-256-GCM streaming archives stored under <code className="font-mono">~/.vmui/backups</code>.
            Sealed with your <code className="font-mono">VMUI_MASTER_KEY</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={refresh} variant="ghost" size="sm" disabled={pending}>
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={handleCreate} disabled={pending} size="sm">
            <Download className="mr-1.5 h-3.5 w-3.5" /> Create backup now
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {backups.length === 0 ? (
          <div className="grid place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-8 text-sm text-muted">
            No local backups yet. Click <strong className="mx-1">Create backup now</strong> to make one.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {backups.map((b) => (
              <li key={b.name} className="flex flex-wrap items-center gap-3 py-2 text-xs">
                <div className="min-w-0 flex-1 truncate font-mono">{b.name}</div>
                <span className="text-muted">{formatBytes(b.bytes)}</span>
                <span className="text-muted">
                  {new Date(b.modifiedAt).toLocaleString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {b.partial && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-600 dark:text-amber-400">
                    partial
                  </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => handleVerify(b.name)} disabled={pending}>
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Verify
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(b.name)}
                  disabled={pending}
                  className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
