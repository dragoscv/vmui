"use client";

import { ProviderName, ProviderTile } from "@/components/cloud/provider-tile";
import { Button } from "@/components/ui";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { CachedResourceRow } from "@/lib/db/schema";
import { formatUsd } from "@/lib/utils";
import { listResourceHistoryAction } from "@/server/actions/resource-history";
import { Check, Copy, ExternalLink, History } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useKindLabel } from "./resource-format";

interface DrawerProps {
  resource: CachedResourceRow | null;
  onClose: () => void;
}

function providerDeepLink(r: CachedResourceRow): string | null {
  if (r.provider === "aws") {
    if (r.kind === "volume") return `https://console.aws.amazon.com/ec2/home?region=${r.region}#Volumes:`;
    if (r.kind === "snapshot") return `https://console.aws.amazon.com/ec2/home?region=${r.region}#Snapshots:`;
    if (r.kind === "vpc") return `https://console.aws.amazon.com/vpc/home?region=${r.region}#vpcs:`;
    if (r.kind === "subnet") return `https://console.aws.amazon.com/vpc/home?region=${r.region}#subnets:`;
    if (r.kind === "security-group") return `https://console.aws.amazon.com/ec2/home?region=${r.region}#SecurityGroups:`;
    if (r.kind === "bucket") return `https://s3.console.aws.amazon.com/s3/buckets/${r.name ?? ""}`;
    if (r.kind === "database") return `https://console.aws.amazon.com/rds/home?region=${r.region}#databases:`;
    if (r.kind === "load-balancer") return `https://console.aws.amazon.com/ec2/home?region=${r.region}#LoadBalancers:`;
    if (r.kind === "dns-zone") return `https://console.aws.amazon.com/route53/v2/hostedzones`;
  }
  if (r.provider === "azure") return `https://portal.azure.com/#@/resource${r.externalId}`;
  if (r.provider === "gcp") {
    if (r.kind === "bucket") return `https://console.cloud.google.com/storage/browser/${r.name ?? ""}`;
    if (r.kind === "database") return `https://console.cloud.google.com/sql/instances`;
  }
  return null;
}

function tryPretty(s: string | null): string {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

type HistoryEntry = Awaited<ReturnType<typeof listResourceHistoryAction>>[number];

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="surface min-w-0 p-3">
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

export function ResourceDetailDrawer({ resource, onClose }: DrawerProps) {
  const t = useTranslations("cloud.resources.detail");
  const kindLabel = useKindLabel();
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!resource) return;
    setHistory([]);
    setShowHistory(false);
    setCopied(false);
    void listResourceHistoryAction({
      accountId: resource.accountId,
      kind: resource.kind,
      externalId: resource.externalId,
    }).then(setHistory);
  }, [resource]);

  const link = resource ? providerDeepLink(resource) : null;
  const rawPretty = resource?.rawJson ? tryPretty(resource.rawJson) : null;

  const copyId = async () => {
    if (!resource) return;
    await navigator.clipboard.writeText(resource.externalId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Sheet open={resource !== null} onOpenChange={(open) => !open && onClose()}>
      {resource && (
        <SheetContent title={resource.name ?? resource.externalId} description={kindLabel(resource.kind)} className="md:w-[520px]">
          <div className="space-y-4 text-sm">
            <button
              type="button"
              onClick={copyId}
              aria-label={t("copyId")}
              className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-[var(--radius-md)] px-2 text-xs text-muted transition-colors hover:bg-bg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
              <code className="truncate font-mono">{resource.externalId}</code>
              <span className="sr-only" aria-live="polite">
                {copied ? t("copied") : ""}
              </span>
            </button>

            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="surface flex min-w-0 items-center gap-3 p-3">
                <ProviderTile provider={resource.provider} size="sm" />
                <div className="min-w-0">
                  <dt className="text-[11px] uppercase tracking-wider text-muted">{t("provider")}</dt>
                  <dd className="truncate">
                    <ProviderName provider={resource.provider} />
                  </dd>
                </div>
              </div>
              <DetailField label={t("region")}>{resource.region}</DetailField>
              <DetailField label={t("status")}>{resource.status ?? "—"}</DetailField>
              <DetailField label={t("cost")}>
                <span className="tabular-nums">{resource.monthlyUsd ? formatUsd(resource.monthlyUsd) : "—"}</span>
              </DetailField>
            </dl>

            {link && (
              <Button asChild variant="outline" size="sm">
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-3.5" aria-hidden />
                  {t("openConsole", { provider: resource.provider.toUpperCase() })}
                </a>
              </Button>
            )}

            {rawPretty && (
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-wider text-muted">{t("raw")}</p>
                <pre className="surface max-h-96 overflow-x-auto p-3 font-mono text-xs leading-relaxed">{rawPretty}</pre>
              </div>
            )}

            {history.length > 0 && (
              <div className="space-y-2">
                <Button variant="outline" size="sm" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
                  <History className="size-3.5" aria-hidden />
                  {showHistory ? t("hideHistory", { count: history.length }) : t("showHistory", { count: history.length })}
                </Button>
                {showHistory && (
                  <ol className="space-y-3">
                    {history.map((h) => (
                      <HistoryDiff key={h.id} entry={h} />
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      )}
    </Sheet>
  );
}

function HistoryDiff({ entry }: { entry: HistoryEntry }) {
  const t = useTranslations("cloud.resources.detail");
  const format = useFormatter();
  const diff = useMemo(() => {
    const prev = tryPretty(entry.prevJson).split("\n");
    const next = tryPretty(entry.nextJson).split("\n");
    const prevSet = new Set(prev);
    const nextSet = new Set(next);
    return {
      removed: prev.filter((l) => !nextSet.has(l)),
      added: next.filter((l) => !prevSet.has(l)),
    };
  }, [entry.prevJson, entry.nextJson]);

  const at = new Date(entry.capturedAt);
  return (
    <li className="surface space-y-1.5 p-3">
      <time dateTime={at.toISOString()} className="block text-[11px] uppercase tracking-wider text-muted">
        {format.dateTime(at, { dateStyle: "medium", timeStyle: "short" })}
      </time>
      <pre className="max-h-48 overflow-x-auto rounded-[var(--radius-md)] bg-bg-muted p-2 font-mono text-xs leading-relaxed">
        {diff.removed.map((l, i) => (
          <div key={`r${i}`} className="text-danger">
            - {l}
          </div>
        ))}
        {diff.added.map((l, i) => (
          <div key={`a${i}`} className="text-success">
            + {l}
          </div>
        ))}
        {diff.removed.length === 0 && diff.added.length === 0 && <div className="text-muted">{t("noLineChanges")}</div>}
      </pre>
    </li>
  );
}
