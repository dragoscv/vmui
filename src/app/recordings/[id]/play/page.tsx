import { db } from "@/lib/db";
import { terminalRecordings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlayRecording({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("viewer");
  const { id } = await params;
  const row = await db.select().from(terminalRecordings).where(eq(terminalRecordings.id, id)).get();
  if (!row) notFound();

  const castUrl = `/api/recordings/${id}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Replay</h1>
        <p className="text-sm text-muted">
          {row.instanceLabel ?? row.sessionId} · {row.cols}×{row.rows} · {(row.durationMs / 1000).toFixed(1)}s · {(row.sizeBytes / 1024).toFixed(1)} KB
        </p>
      </header>
      <div className="rounded-lg border border-[var(--color-border)] bg-black p-2">
        {/* asciinema-player web component, lazy-loaded from CDN */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/asciinema-player@3.7.0/dist/bundle/asciinema-player.css" />
        <script
          type="module"
          dangerouslySetInnerHTML={{
            __html: `
              import { create } from 'https://cdn.jsdelivr.net/npm/asciinema-player@3.7.0/+esm';
              create('${castUrl}', document.getElementById('player'), { autoPlay: true, fit: 'width', theme: 'monokai' });
            `,
          }}
        />
        <div id="player" />
      </div>
      <p className="text-xs text-muted">
        Tip: download the <code className="rounded bg-[var(--color-surface-muted)] px-1">.cast</code> file and replay locally with <code className="rounded bg-[var(--color-surface-muted)] px-1">asciinema play</code>.
      </p>
    </main>
  );
}
