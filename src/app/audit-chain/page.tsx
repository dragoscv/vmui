import "server-only";
import { verifyAuditChain } from "@/lib/audit-chain";
import { db } from "@/lib/db";
import { auditChain } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function AuditChainPage() {
  const [verify, segs] = await Promise.all([
    verifyAuditChain(),
    db.select().from(auditChain).orderBy(desc(auditChain.id)).limit(50),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log signing chain</h1>
        <p className="text-sm text-zinc-400">
          Every 5 minutes the scheduler folds new audit rows into a hash chain (SHA-256 over canonical JSON), then HMACs the segment hash with the master key. Tampering breaks verification.
        </p>
      </header>

      <div className={`rounded-lg border p-4 text-sm ${verify.ok ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300" : "border-rose-500/30 bg-rose-950/30 text-rose-300"}`}>
        <div className="font-semibold">{verify.ok ? "✓ Chain verified" : "✗ Chain INVALID"}</div>
        <div className="mt-1 text-xs">{verify.segments} segments · {verify.reason ?? "all hashes & HMACs match"}</div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 uppercase"><tr><th className="px-3 py-2 text-left">Seg</th><th className="px-3 py-2 text-left">Audit IDs</th><th className="px-3 py-2 text-left">Hash</th><th className="px-3 py-2 text-left">HMAC</th><th className="px-3 py-2 text-left">When</th></tr></thead>
          <tbody>
            {segs.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-zinc-500">No segments yet — scheduler will append on next tick.</td></tr>}
            {segs.map((s) => (
              <tr key={s.id} className="border-t border-zinc-900 font-mono">
                <td className="px-3 py-2">{s.id}</td>
                <td className="px-3 py-2">{s.fromAuditId}–{s.toAuditId}</td>
                <td className="px-3 py-2 truncate max-w-[14rem]">{s.hash.slice(0, 16)}…</td>
                <td className="px-3 py-2 truncate max-w-[14rem]">{s.hmac.slice(0, 16)}…</td>
                <td className="px-3 py-2">{s.computedAt.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
