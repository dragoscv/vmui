import "server-only";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { ArrowLeft, GitCommitVertical } from "lucide-react";
import { db } from "@/lib/db";
import { resourceHistory, cloudAccounts } from "@/lib/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";

function tryPretty(s: string | null): string {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function diffLines(a: string | null, b: string): { added: number; removed: number } {
  const pa = new Set(tryPretty(a).split("\n"));
  const pb = new Set(tryPretty(b).split("\n"));
  let added = 0;
  let removed = 0;
  for (const l of pb) if (!pa.has(l)) added++;
  for (const l of pa) if (!pb.has(l)) removed++;
  return { added, removed };
}

export default async function DriftPage() {
  const [rows, accounts] = await Promise.all([
    db.select().from(resourceHistory).orderBy(desc(resourceHistory.capturedAt)).limit(150),
    db.select().from(cloudAccounts),
  ]);
  const acctMap = new Map(accounts.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link href="/resources" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            <ArrowLeft className="h-3.5 w-3.5" /> Resources
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Drift history</h1>
          <p className="text-sm text-muted">
            Append-only log of every cached-resource rawJson change detected at sync time.
          </p>
        </div>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted">
            No drift recorded yet. Drift is captured on the next resource sync after a provider-side change.
          </CardContent>
        </Card>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => {
            const acc = acctMap.get(r.accountId);
            const d = diffLines(r.prevJson, r.nextJson);
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2 text-xs"
              >
                <GitCommitVertical className="h-3.5 w-3.5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="info">{r.kind}</Badge>
                    <code className="truncate font-mono text-[10px]">{r.externalId}</code>
                    <span className="text-muted">{r.region}</span>
                    <span className="text-muted">{acc?.name ?? "(unknown)"}</span>
                  </div>
                  <div className="mt-1 flex gap-3 font-mono text-[10px]">
                    <span className="text-[oklch(0.62_0.14_145)]">+{d.added}</span>
                    <span className="text-[oklch(0.58_0.16_25)]">-{d.removed}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right text-[10px] text-muted">
                  {formatRelative(r.capturedAt)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
