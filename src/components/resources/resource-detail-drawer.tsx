"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ExternalLink, Copy, Check, Cloud, MapPin, Tag, Database, History } from "lucide-react";
import type { CachedResourceRow } from "@/lib/db/schema";
import { formatUsd } from "@/lib/utils";
import { listResourceHistoryAction } from "@/server/actions/resource-history";

interface DrawerProps {
  resource: CachedResourceRow | null;
  onClose: () => void;
}

function providerDeepLink(r: CachedResourceRow): string | null {
  // Best-effort console URLs; not all resources are addressable directly.
  if (r.provider === "aws") {
    if (r.kind === "volume") return `https://console.aws.amazon.com/ec2/home?region=${r.region}#Volumes:`;
    if (r.kind === "snapshot") return `https://console.aws.amazon.com/ec2/home?region=${r.region}#Snapshots:`;
    if (r.kind === "vpc") return `https://console.aws.amazon.com/vpc/home?region=${r.region}#vpcs:`;
    if (r.kind === "subnet") return `https://console.aws.amazon.com/vpc/home?region=${r.region}#subnets:`;
    if (r.kind === "security-group")
      return `https://console.aws.amazon.com/ec2/home?region=${r.region}#SecurityGroups:`;
    if (r.kind === "bucket") return `https://s3.console.aws.amazon.com/s3/buckets/${r.name ?? ""}`;
    if (r.kind === "database")
      return `https://console.aws.amazon.com/rds/home?region=${r.region}#databases:`;
    if (r.kind === "load-balancer")
      return `https://console.aws.amazon.com/ec2/home?region=${r.region}#LoadBalancers:`;
    if (r.kind === "dns-zone") return `https://console.aws.amazon.com/route53/v2/hostedzones`;
  }
  if (r.provider === "azure") {
    return `https://portal.azure.com/#@/resource${r.externalId}`;
  }
  if (r.provider === "gcp") {
    if (r.kind === "bucket") return `https://console.cloud.google.com/storage/browser/${r.name ?? ""}`;
    if (r.kind === "database") return `https://console.cloud.google.com/sql/instances`;
  }
  return null;
}

export function ResourceDetailDrawer({ resource, onClose }: DrawerProps) {
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof listResourceHistoryAction>>>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!resource) return;
    setHistory([]);
    setShowHistory(false);
    void listResourceHistoryAction({
      accountId: resource.accountId,
      kind: resource.kind,
      externalId: resource.externalId,
    }).then(setHistory);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resource, onClose]);

  if (!resource) return null;

  const link = providerDeepLink(resource);
  const rawPretty = resource.rawJson
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(resource.rawJson), null, 2);
        } catch {
          return resource.rawJson;
        }
      })()
    : null;

  const copyId = async () => {
    await navigator.clipboard.writeText(resource.externalId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted">{resource.kind}</div>
            <h2 className="truncate text-lg font-semibold">{resource.name ?? "—"}</h2>
            <button
              onClick={copyId}
              className="mt-1 inline-flex items-center gap-1 rounded text-xs text-muted hover:text-fg"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              <code className="font-mono">{resource.externalId}</code>
            </button>
          </div>
          <button
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-muted hover:bg-[var(--color-bg-muted)] hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <Field icon={Cloud} k="Provider" v={resource.provider.toUpperCase()} />
            <Field icon={MapPin} k="Region" v={resource.region} />
            <Field icon={Tag} k="Status" v={resource.status ?? "—"} />
            <Field
              icon={Database}
              k="Cost / mo"
              v={resource.monthlyUsd ? formatUsd(resource.monthlyUsd) : "—"}
            />
          </dl>

          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-bg-muted)]"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Open in {resource.provider} console
            </a>
          )}

          {rawPretty && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider text-muted">Raw payload</div>
              <pre className="max-h-96 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)]/60 p-3 font-mono text-[10px] leading-relaxed">
                {rawPretty}
              </pre>
            </div>
          )}

          {history.length > 0 && (
            <div>
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-bg-muted)]"
              >
                <History className="h-3.5 w-3.5" />
                {showHistory ? "Hide" : "Show"} drift history ({history.length})
              </button>
              {showHistory && (
                <ol className="mt-2 space-y-3">
                  {history.map((h) => (
                    <HistoryDiff key={h.id} entry={h} />
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Field({ icon: Icon, k, v }: { icon: typeof Cloud; k: string; v: string }) {
  return (
    <div className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2">
      <Icon className="h-3.5 w-3.5 text-muted" />
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted">{k}</div>
        <div className="text-sm">{v}</div>
      </div>
    </div>
  );
}

function tryPretty(s: string | null): string {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function HistoryDiff({
  entry,
}: {
  entry: { id: string; capturedAt: Date; prevJson: string | null; nextJson: string };
}) {
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

  return (
    <li className="rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-3">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted">
        {entry.capturedAt instanceof Date
          ? entry.capturedAt.toLocaleString()
          : new Date(entry.capturedAt).toLocaleString()}
      </div>
      <pre className="max-h-48 overflow-auto rounded bg-[var(--color-bg)]/80 p-2 font-mono text-[10px] leading-relaxed">
        {diff.removed.map((l, i) => (
          <div key={`r${i}`} className="text-[oklch(0.58_0.16_25)]">- {l}</div>
        ))}
        {diff.added.map((l, i) => (
          <div key={`a${i}`} className="text-[oklch(0.62_0.14_145)]">+ {l}</div>
        ))}
        {diff.removed.length === 0 && diff.added.length === 0 && (
          <div className="text-muted">(no line-level changes; whitespace or ordering only)</div>
        )}
      </pre>
    </li>
  );
}
