"use client";
import { useState, useTransition } from "react";
import type { InstanceRunbookRow } from "@/lib/db/schema";
import { upsertRunbookAction, deleteRunbookAction } from "@/server/actions/extras";

export function RunbookEditorClient({
  accountId,
  providerInstanceId,
  initial,
}: {
  accountId: string;
  providerInstanceId: string;
  initial: InstanceRunbookRow[];
}) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<InstanceRunbookRow | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  function startNew() {
    setEditing({ id: "", accountId, providerInstanceId, title: "", body: "", createdAt: new Date(), updatedAt: new Date(), createdBy: null });
    setTitle("");
    setBody("");
  }
  function startEdit(r: InstanceRunbookRow) {
    setEditing(r);
    setTitle(r.title);
    setBody(r.body);
  }
  function cancel() { setEditing(null); }

  function save() {
    start(async () => {
      const id = editing?.id || undefined;
      await upsertRunbookAction({ id, accountId, providerInstanceId, title, body });
      setEditing(null);
      const newRow: InstanceRunbookRow = {
        id: id ?? crypto.randomUUID(),
        accountId, providerInstanceId, title, body,
        createdAt: editing?.createdAt ?? new Date(), updatedAt: new Date(), createdBy: editing?.createdBy ?? null,
      };
      setRows((prev) => id ? prev.map((r) => r.id === id ? newRow : r) : [newRow, ...prev]);
    });
  }
  function remove(id: string) {
    start(async () => {
      await deleteRunbookAction(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">Runbooks</h3>
        {!editing && <button onClick={startNew} className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 text-xs">New</button>}
      </div>

      {editing ? (
        <div className="rounded border border-zinc-800 bg-zinc-950 p-3 space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Markdown body…" rows={8} className="w-full rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm font-mono" />
          <div className="flex justify-end gap-2">
            <button onClick={cancel} disabled={pending} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1">Cancel</button>
            <button onClick={save} disabled={pending || !title || !body} className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-2 py-1 text-xs">Save</button>
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {rows.length === 0 && !editing && <div className="text-xs text-zinc-500">No runbooks yet.</div>}
        {rows.map((r) => (
          <details key={r.id} className="rounded border border-zinc-800 bg-zinc-950 p-2 group">
            <summary className="flex items-center justify-between cursor-pointer text-sm">
              <span className="font-medium">{r.title}</span>
              <span className="text-xs text-zinc-500">{r.updatedAt.toLocaleDateString()}</span>
            </summary>
            <pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-300 font-mono">{r.body}</pre>
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => startEdit(r)} className="text-xs text-emerald-300 hover:text-emerald-200 px-2 py-1">Edit</button>
              <button onClick={() => remove(r.id)} disabled={pending} className="text-xs text-rose-300 hover:text-rose-200 px-2 py-1">Delete</button>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
