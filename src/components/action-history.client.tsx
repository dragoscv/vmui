"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { replayAuditAction } from "@/server/actions/replay";

interface Row { id: number; createdAt: string; action: string; target: string | null; status: string; message: string | null; accountId: string | null }
interface Props { rows: Row[] }

const REPLAYABLE = new Set(["instance.start", "instance.stop", "instance.reboot"]);

export function ActionHistoryClient({ rows }: Props) {
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();
  const filtered = rows.filter((r) => !filter || r.action.includes(filter) || (r.target ?? "").includes(filter));

  function replay(id: number) {
    start(async () => {
      const res = await replayAuditAction({ auditId: id });
      if (res.ok) toast.success("Replayed");
      else toast.error(res.error ?? "Replay failed");
    });
  }

  return (
    <div className="space-y-4">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by action / target…"
        className="w-full max-w-sm rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
      />
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-left">Target</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Message</th><th className="px-3 py-2"></th></tr></thead>
          <tbody>
            {filtered.length === 0 && (<tr><td colSpan={6} className="px-3 py-6 text-zinc-500">No matching rows.</td></tr>)}
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-zinc-900">
                <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.target ?? ""}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs ${r.status === "ok" ? "text-emerald-400" : "text-rose-400"}`}>{r.status}</span>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-300 truncate max-w-md">{r.message ?? ""}</td>
                <td className="px-3 py-2 text-right">
                  {REPLAYABLE.has(r.action) ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => replay(r.id)}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs hover:bg-zinc-800 disabled:opacity-40"
                    >Replay</button>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
