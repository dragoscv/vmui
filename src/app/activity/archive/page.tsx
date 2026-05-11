import "server-only";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { Archive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AuditArchivePage() {
  const dbPath = resolve(process.cwd(), env.VMUI_DB_PATH);
  const archiveDir = resolve(dirname(dbPath), "audit-archive");

  let files: { name: string; size: number; mtime: Date }[] = [];
  if (existsSync(archiveDir)) {
    files = readdirSync(archiveDir)
      .filter((f) => f.endsWith(".json.gz"))
      .map((f) => {
        const s = statSync(join(archiveDir, f));
        return { name: f, size: s.size, mtime: s.mtime };
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Archive className="h-6 w-6 text-[var(--color-primary)]" />
          Audit archives
        </h1>
        <p className="text-sm text-muted">
          Audit-log rows older than 30 days are gzipped and moved here. To inspect a file:{" "}
          <code className="font-mono text-[11px]">gunzip -c {archiveDir}/&lt;file&gt;</code>.
        </p>
      </div>

      <Card className="surface">
        <CardHeader>
          <CardTitle className="text-base">Archive files</CardTitle>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <p className="text-sm text-muted">No archives yet. They appear after the first prune cycle (24h after start).</p>
          ) : (
            <div className="grid gap-2">
              {files.map((f) => (
                <div
                  key={f.name}
                  className="flex flex-wrap items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2"
                >
                  <div>
                    <div className="font-mono text-sm">{f.name}</div>
                    <div className="text-xs text-muted">{f.mtime.toLocaleString()}</div>
                  </div>
                  <div className="text-xs text-muted">{(f.size / 1024).toFixed(1)} KB</div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted">Archive folder: <code className="font-mono">{archiveDir}</code></p>
        </CardContent>
      </Card>
    </div>
  );
}
