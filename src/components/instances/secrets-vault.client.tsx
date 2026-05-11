"use client";
import { useState, useTransition } from "react";
import type { InstanceSecretRow } from "@/lib/db/schema";
import { setInstanceSecretAction, deleteInstanceSecretAction } from "@/server/actions/extras-2";

type Row = Pick<InstanceSecretRow, "id" | "key" | "updatedAt">;

export function SecretsVaultClient({
  accountId,
  providerInstanceId,
  initial,
}: {
  accountId: string;
  providerInstanceId: string;
  initial: Row[];
}) {
  const [rows, setRows] = useState(initial);
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const [pending, start] = useTransition();

  function add() {
    start(async () => {
      const key = k.trim();
      if (!key) return;
      await setInstanceSecretAction({ accountId, providerInstanceId, key, value: v });
      setRows((prev) => prev.find((r) => r.key === key)
        ? prev.map((r) => r.key === key ? { ...r, updatedAt: new Date() } : r)
        : [{ id: crypto.randomUUID(), key, updatedAt: new Date() }, ...prev]);
      setK("");
      setV("");
    });
  }
  function remove(id: string) {
    start(async () => {
      await deleteInstanceSecretAction(id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    });
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Secrets vault</h3>
        <span className="text-xs text-zinc-500">AES-256-GCM at rest</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={k} onChange={(e) => setK(e.target.value.toUpperCase())} placeholder="KEY_NAME" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm font-mono" />
        <input value={v} onChange={(e) => setV(e.target.value)} type="password" placeholder="value" className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm sm:col-span-2" />
      </div>
      <div className="flex justify-end"><button onClick={add} disabled={pending || !k} className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-2 py-1 text-xs">Save secret</button></div>

      <div className="space-y-1 text-xs">
        {rows.length === 0 && <div className="text-zinc-500">No secrets yet.</div>}
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
            <div className="font-mono">{r.key}</div>
            <div className="flex items-center gap-3 text-zinc-500">
              <span>updated {r.updatedAt.toLocaleDateString()}</span>
              <button onClick={() => remove(r.id)} disabled={pending} className="text-rose-300 hover:text-rose-200">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
