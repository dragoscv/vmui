import { db } from "@/lib/db";
import { runbooks } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { upsertRunbookAction, deleteRunbookAction } from "@/server/actions/automation";
import { BookOpen, Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RunbooksPage() {
  const rows = await db.select().from(runbooks).orderBy(desc(runbooks.updatedAt));

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-[var(--color-primary)]" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runbooks</h1>
          <p className="text-sm text-muted">Markdown procedures attached to instances or accounts. Track who runs what, when.</p>
        </div>
      </header>

      <form action={async (fd) => {
        "use server";
        await upsertRunbookAction({
          title: String(fd.get("title") ?? ""),
          body: String(fd.get("body") ?? ""),
          accountId: (fd.get("accountId") as string) || null,
          providerInstanceId: (fd.get("providerInstanceId") as string) || null,
        });
      }} className="grid gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input name="title" required placeholder="Runbook title…" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm" />
          <input name="providerInstanceId" placeholder="Provider instance ID (optional)" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm" />
        </div>
        <textarea name="body" rows={6} placeholder="# Steps&#10;- [ ] Drain traffic&#10;- [ ] `sudo systemctl stop app`&#10;- [ ] Verify…" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 font-mono text-xs" />
        <button className="self-start rounded bg-[var(--color-primary)] px-3 py-1 text-sm text-white">Save runbook</button>
      </form>

      {rows.length === 0 ? (
        <p className="text-center text-xs text-muted">No runbooks yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-[var(--color-border)] p-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-medium">{r.title}</h2>
                  <p className="text-xs text-muted">
                    {r.providerInstanceId ? <span className="font-mono">{r.providerInstanceId}</span> : "fleet-wide"} ·
                    updated {r.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
                  </p>
                </div>
                <form action={async () => { "use server"; await deleteRunbookAction(r.id); }}>
                  <button className="inline-flex items-center gap-1 rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </form>
              </div>
              <pre className="mt-2 whitespace-pre-wrap rounded bg-[var(--color-surface-muted)] p-2 font-mono text-xs">{r.body}</pre>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
