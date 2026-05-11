import { db } from "@/lib/db";
import { terminalRecordings } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { TerminalSquare, Download, Play } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function RecordingsPage() {
  const rows = await db.select().from(terminalRecordings).orderBy(desc(terminalRecordings.startedAt)).limit(200);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <TerminalSquare className="h-6 w-6 text-[var(--color-primary)]" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Terminal recordings</h1>
          <p className="text-sm text-muted">
            Every SSH session is captured as an asciinema cast v2 file. Disable with <code className="rounded bg-[var(--color-surface-muted)] px-1">VMUI_RECORD_TERMINAL=0</code>.
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-6 text-center text-sm text-muted">
          No recordings yet. Open a terminal session to start one.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Term</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--color-surface-muted)]">
                  <td className="px-3 py-2 font-mono text-xs">{r.startedAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                  <td className="px-3 py-2">{r.instanceLabel ?? <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtBytes(r.sizeBytes)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtDuration(r.durationMs)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">{r.cols}×{r.rows}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/recordings/${r.id}/play`} className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]">
                      <Play className="h-3 w-3" /> Play
                    </Link>
                    <Link href={`/api/recordings/${r.id}`} className="ml-1 inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]">
                      <Download className="h-3 w-3" /> .cast
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
