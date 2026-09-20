"use client";

import { Badge, Button, EmptyState, PageSection } from "@/components/ui";
import { Check, Copy, Download, FileCode } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

interface SshHost {
  id: string;
  host: string;
  provider: string;
  ip: string;
  keyName: string | null;
  platform: string;
}

const DEFAULT_USER: Record<string, string> = {
  aws: "ec2-user",
  azure: "azureuser",
  gcp: "ubuntu",
  scaleway: "m1",
  "local-kvm": "ubuntu",
};

function safeAlias(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "-").toLowerCase();
}

export function SshConfigExport({ instances }: { instances: SshHost[] }) {
  const t = useTranslations("settings.access.sshKeys.config");
  const [copied, setCopied] = useState(false);
  const linuxOnly = useMemo(() => instances.filter((i) => i.platform !== "windows"), [instances]);
  const header = t("header");

  const config = useMemo(() => {
    const lines: string[] = [`# ${header}`, ""];
    for (const i of linuxOnly) {
      const alias = `vmui-${safeAlias(i.host)}`;
      const user = DEFAULT_USER[i.provider] ?? "root";
      lines.push(`Host ${alias}`);
      lines.push(`  HostName ${i.ip}`);
      lines.push(`  User ${user}`);
      if (i.keyName) lines.push(`  # AWS keypair: ${i.keyName}`);
      lines.push(`  ServerAliveInterval 30`);
      lines.push(`  ServerAliveCountMax 3`);
      lines.push("");
    }
    return lines.join("\n");
  }, [linuxOnly, header]);

  const copy = async () => {
    await navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vmui-ssh-config";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (linuxOnly.length === 0) {
    return (
      <PageSection title={t("title")} description={t("description")}>
        <EmptyState icon={<FileCode />} title={t("empty")} description={t("emptyHint")} />
      </PageSection>
    );
  }

  return (
    <PageSection
      title={t("title")}
      description={t("description")}
      action={
        <>
          <Badge variant="info">{t("hosts", { count: linuxOnly.length })}</Badge>
          <Button size="sm" onClick={() => void copy()}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? t("copied") : t("copy")}
          </Button>
          <Button size="sm" variant="outline" onClick={download}>
            <Download className="size-4" aria-hidden /> {t("download")}
          </Button>
        </>
      }
    >
      <pre className="max-h-72 overflow-auto rounded-[var(--radius-md)] border border-border bg-bg-muted p-3 font-mono text-xs">{config}</pre>
    </PageSection>
  );
}
