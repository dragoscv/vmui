import "server-only";
import { db } from "@/lib/db";
import { instanceTrash } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { deleteFromTrashAction } from "@/server/actions/extras-2";

export const dynamic = "force-dynamic";

async function purge(formData: FormData) {
  "use server";
  await deleteFromTrashAction(String(formData.get("id") ?? ""));
}

export default async function TrashPage() {
  const rows = await db.select().from(instanceTrash).orderBy(desc(instanceTrash.terminatedAt)).limit(500);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        <p className="text-sm text-zinc-400">
          Metadata of terminated instances kept for forensic / restore-as-data lookup. Restore buttons would re-create from raw JSON; for now you can copy fields out.
        </p>
      </header>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Provider</th><th className="px-3 py-2 text-left">Region</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-left">Terminated</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-zinc-500">Trash is empty.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-900">
                <td className="px-3 py-2"><div className="font-medium">{r.name ?? r.providerInstanceId}</div><div className="text-xs font-mono text-zinc-500">{r.providerInstanceId}</div></td>
                <td className="px-3 py-2 text-xs">{r.provider}</td>
                <td className="px-3 py-2 text-xs">{r.region}</td>
                <td className="px-3 py-2 text-xs font-mono">{r.instanceType ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.terminatedAt.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">
                  <form action={purge}><input type="hidden" name="id" value={r.id} /><button type="submit" className="text-rose-300 hover:text-rose-200 text-xs">Purge</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
