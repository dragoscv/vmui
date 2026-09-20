"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import type { InstanceRow } from "@/lib/db/schema";
import type { ConnectionInfo } from "@/lib/providers/types";
import { cn } from "@/lib/utils";
import { getConnectionInfoAction } from "@/server/actions/instances";
import { getWindowsPasswordAction } from "@/server/actions/windows-password";
import { ChevronDown, Copy, Download, Eye, EyeOff, KeyRound, Loader2, MonitorPlay, Terminal as TerminalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export function ConnectDialog({
  open,
  onOpenChange,
  instance,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  instance: InstanceRow;
}) {
  const t = useTranslations("vm.connect");
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
    toast.success(t("downloaded", { file: info.fileName ?? "" }));
  }

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    toast.success(t("copied", { label }));
  }

  const description =
    instance.provider === "local-kvm"
      ? t("descLocalKvm")
      : instance.platform === "windows"
        ? t("descWindows")
        : instance.platform === "macos"
          ? t("descMacos")
          : t("descLinux");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("title", { name: instance.name ?? instance.providerInstanceId })}
            <Badge variant="info">{info?.protocol?.toUpperCase() ?? "…"}</Badge>
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("resolving")}
          </div>
        )}

        {error && <Alert tone="danger">{error}</Alert>}

        {info && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-md)] bg-bg-muted p-3 font-mono text-xs">
              <div className="text-muted">{t("host")}</div>
              <div className="col-span-2 truncate">{info.host}</div>
              <div className="text-muted">{t("port")}</div>
              <div className="col-span-2">{info.port}</div>
              <div className="text-muted">{t("user")}</div>
              <div className="col-span-2">{info.username}</div>
            </div>

            {info.sshCommand && (
              <CopyRow label={t("sshCommand")} value={info.sshCommand} onCopy={copy} copyLabel={t("copy", { label: t("sshCommand") })} />
            )}

            {info.vncUrl && (
              <CopyRow
                label={instance.provider === "local-kvm" ? t("vncUrl") : t("vncUrlTunnel")}
                value={info.vncUrl}
                onCopy={(v) => copy(v, t("vncUrl"))}
                copyLabel={t("copy", { label: t("vncUrl") })}
              />
            )}

            {info.notes.length > 0 && (
              <div className="rounded-[var(--radius-md)] border border-border p-3 text-xs leading-relaxed text-muted">
                {info.notes.map((n, i) => (
                  <div key={i} className={n.startsWith("  ") ? "font-mono whitespace-pre" : ""}>
                    {n}
                  </div>
                ))}
              </div>
            )}

            {instance.provider === "aws" && instance.platform === "windows" && (
              <WindowsPasswordSection instance={instance} />
            )}
          </div>
        )}

        <DialogFooter>
          {instance.provider === "local-kvm" && (
            <Button asChild variant="primary">
              <Link href={`/instances/${encodeURIComponent(instance.id)}/console`}>
                <MonitorPlay className="h-4 w-4" aria-hidden /> {t("openInBrowser")}
              </Link>
            </Button>
          )}
          {info?.protocol === "ssh" && (
            <Button asChild variant={instance.provider === "local-kvm" ? "secondary" : "primary"}>
              <Link href={`/instances/${encodeURIComponent(instance.id)}/ssh`}>
                <TerminalIcon className="h-4 w-4" aria-hidden /> {t("browserSsh")}
              </Link>
            </Button>
          )}
          {info?.fileContent && (
            <Button onClick={downloadFile} variant={instance.provider === "local-kvm" ? "secondary" : "primary"}>
              <Download className="h-4 w-4" aria-hidden /> {t("download", { file: info.fileName ?? "" })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  onCopy: (value: string, label: string) => void;
  copyLabel: string;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-[var(--radius-md)] bg-bg-muted px-3 py-2 font-mono text-xs">{value}</code>
        <Button variant="secondary" size="icon" aria-label={copyLabel} onClick={() => onCopy(value, label)}>
          <Copy className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function WindowsPasswordSection({ instance }: { instance: InstanceRow }) {
  const t = useTranslations("vm.connect.winPassword");
  const [open, setOpen] = useState(false);
  const [pem, setPem] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDecrypt() {
    setLoading(true);
    setError(null);
    const r = await getWindowsPasswordAction({
      accountId: instance.accountId,
      providerInstanceId: instance.providerInstanceId,
      privateKeyPem: pem,
    });
    setLoading(false);
    if (r.ok) {
      setPassword(r.password);
      // Clear PEM from memory once decrypted.
      setPem("");
      toast.success(t("decrypted"));
    } else {
      setError(r.error);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setPem(text);
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-border p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden />
          {t("title")}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="mt-3 space-y-2 text-xs">
          <p className="text-muted">
            {t.rich("body", { code: (c) => <code>{c}</code> })}
          </p>

          {password ? (
            <>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-[var(--radius-md)] bg-bg-muted px-3 py-2 font-mono">
                  {reveal ? password : "•".repeat(password.length)}
                </code>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? t("hide") : t("reveal")}
                  aria-pressed={reveal}
                >
                  {reveal ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => {
                    void navigator.clipboard.writeText(password);
                    toast.success(t("copied"));
                  }}
                  aria-label={t("copy")}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setPassword(null)}>
                {t("decryptAgain")}
              </Button>
            </>
          ) : (
            <>
              <Field label={t("pemLabel")}>
                <Textarea
                  value={pem}
                  onChange={(e) => setPem(e.target.value)}
                  placeholder={t("pemPlaceholder")}
                  rows={6}
                  spellCheck={false}
                  className="font-mono text-[11px]"
                />
              </Field>
              <div className="flex items-end gap-2">
                <Field label={t("fileLabel")} className="flex-1">
                  <Input
                  type="file"
                  accept=".pem,.key,.txt,application/x-pem-file"
                  onChange={handleFile}
                  className="text-xs file:mr-2 file:rounded-[var(--radius-sm)] file:border-0 file:bg-bg-muted file:px-3 file:py-1 file:text-xs file:font-medium file:text-fg"
                  />
                </Field>
                <Button onClick={handleDecrypt} disabled={!pem} loading={loading} size="sm">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden />
                  {t("decrypt")}
                </Button>
              </div>
            </>
          )}

          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </div>
  );
}
