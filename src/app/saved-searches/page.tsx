import "server-only";
import { db } from "@/lib/db";
import { savedSearches } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { createSavedSearchAction, deleteSavedSearchAction } from "@/server/actions/extras";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  await createSavedSearchAction({
    name: String(formData.get("name") ?? ""),
    query: String(formData.get("query") ?? ""),
    pinned: formData.get("pinned") === "on",
  });
}
async function remove(formData: FormData) {
  "use server";
  await deleteSavedSearchAction(String(formData.get("id") ?? ""));
}

export default async function SavedSearchesPage() {
  const rows = await db.select().from(savedSearches).orderBy(desc(savedSearches.pinned), desc(savedSearches.createdAt));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Saved searches</h1>
        <p className="text-sm text-zinc-400">Reusable instance-list URLs. Use the same query string format as the instances page (e.g. <code className="text-xs bg-zinc-900 px-1 rounded">provider=aws&amp;state=running</code>).</p>
      </header>

      <form action={create} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input name="name" placeholder="Name (e.g. Prod EU running)" required className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm" />
          <input name="query" placeholder="provider=aws&state=running" required className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm sm:col-span-2 font-mono" />
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" name="pinned" /> Pinned</label>
          <button type="submit" className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-sm">Save</button>
        </div>
      </form>

      <div className="space-y-2">
        {rows.length === 0 && <div className="text-sm text-zinc-500">No saved searches.</div>}
        {rows.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 p-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-medium">{s.pinned && <span title="pinned">📌</span>}{s.name}</div>
              <Link href={`/instances?${s.query}`} className="text-xs font-mono text-emerald-300 hover:text-emerald-200 break-all">/instances?{s.query}</Link>
            </div>
            <form action={remove}><input type="hidden" name="id" value={s.id} /><button type="submit" className="text-rose-300 hover:text-rose-200 text-xs">Delete</button></form>
          </div>
        ))}
      </div>
    </div>
  );
}

void eq;
