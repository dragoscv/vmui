"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Copy, Loader2, MonitorPlay } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getConnectionInfoAction } from "@/server/actions/instances";
import type { ConnectionInfo } from "@/lib/providers/types";
import type { InstanceRow } from "@/lib/db/schema";

export function ConnectDialog({
  open,
  onOpenChange,
  instance,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instance: InstanceRow;
}) {
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setInfo(null);
    setError(null);
    setLoading(true);
    getConnectionInfoAction({
      accountId: instance.accountId,
      region: instance.region,
      providerInstanceId: instance.providerInstanceId,
    })
      .then((r) => {
        if (r.ok) setInfo(r.info);
        else setError(r.error);
      })
      .finally(() => setLoading(false));
  }, [open, instance]);

  function downloadFile() {
    if (!info?.fileContent) return;
    const blob = new Blob([info.fileContent], { type: info.fileMime ?? "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = info.fileName ?? "connection.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${info.fileName}`);
  }

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Connect to {instance.name ?? instance.providerInstanceId}
            <Badge variant="info">{info?.protocol?.toUpperCase() ?? "…"}</Badge>
          </DialogTitle>
          <DialogDescription>
            {instance.provider === "local-kvm"
              ? "Local QEMU/KVM macOS VM. Connect via VNC on localhost — no tunnel needed."
              : instance.platform === "windows"
                ? "Download an .rdp file and open with Microsoft Remote Desktop."
                : instance.platform === "macos"
                  ? "macOS uses VNC over an SSH tunnel for secure GUI access."
                  : "SSH connection details for this Linux instance."}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Resolving connection…
          </div>
        )}

        {error && <div className="rounded-md bg-[color-mix(in_oklch,var(--color-danger)_15%,transparent)] p-3 text-sm text-[var(--color-danger)]">{error}</div>}

        {info && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 rounded-md bg-[var(--color-bg-muted)] p-3 font-mono text-xs">
              <div className="text-muted">host</div>
              <div className="col-span-2 truncate">{info.host}</div>
              <div className="text-muted">port</div>
              <div className="col-span-2">{info.port}</div>
              <div className="text-muted">user</div>
              <div className="col-span-2">{info.username}</div>
            </div>

            {info.sshCommand && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">SSH command</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-[var(--color-bg-muted)] px-3 py-2 font-mono text-xs">
                    {info.sshCommand}
                  </code>
                  <Button variant="secondary" size="icon" onClick={() => copy(info.sshCommand!, "SSH command")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {info.vncUrl && (
              <div>
                <div className="mb-1 text-xs font-medium text-muted">
                  {instance.provider === "local-kvm" ? "VNC URL" : "VNC URL (after SSH tunnel)"}
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-[var(--color-bg-muted)] px-3 py-2 font-mono text-xs">
                    {info.vncUrl}
                  </code>
                  <Button variant="secondary" size="icon" onClick={() => copy(info.vncUrl!, "VNC URL")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {info.notes.length > 0 && (
              <div className="rounded-md border border-[var(--color-border)] p-3 text-xs leading-relaxed text-muted">
                {info.notes.map((n, i) => (
                  <div key={i} className={n.startsWith("  ") ? "font-mono whitespace-pre" : ""}>
                    {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {instance.provider === "local-kvm" && (
            <Button asChild variant="primary">
              <Link href={`/instances/${encodeURIComponent(instance.id)}/console`}>
                <MonitorPlay className="h-4 w-4" /> Open in browser
              </Link>
            </Button>
          )}
          {info?.fileContent && (
            <Button onClick={downloadFile} variant={instance.provider === "local-kvm" ? "secondary" : "primary"}>
              <Download className="h-4 w-4" /> Download {info.fileName}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
