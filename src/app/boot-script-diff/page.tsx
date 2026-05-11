import "server-only";
import { db } from "@/lib/db";
import { bootScripts } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface DiffOp { type: "ctx" | "add" | "del"; line: string; }

/** Tiny LCS-based line diff. O(n*m) – fine for boot scripts. */
function diffLines(a: string, b: string): DiffOp[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const m = A.length, n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const dpi = dp[i]!; const dpi1 = dp[i + 1]!;
      dpi[j] = A[i] === B[j] ? (dpi1[j + 1] ?? 0) + 1 : Math.max(dpi1[j] ?? 0, dpi[j + 1] ?? 0);
    }
  }
  const out: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ type: "ctx", line: A[i] ?? "" }); i++; j++; }
    else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) { out.push({ type: "del", line: A[i] ?? "" }); i++; }
    else { out.push({ type: "add", line: B[j] ?? "" }); j++; }
  }
  while (i < m) { out.push({ type: "del", line: A[i] ?? "" }); i++; }
  while (j < n) { out.push({ type: "add", line: B[j] ?? "" }); j++; }
  return out;
}

export default async function BootScriptDiffPage(props: { searchParams?: Promise<{ a?: string; b?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const scripts = await db.select().from(bootScripts).orderBy(asc(bootScripts.name));
  const a = scripts.find((s) => s.id === sp.a);
  const b = scripts.find((s) => s.id === sp.b);
  const ops = a && b ? diffLines(a.body, b.body) : null;

  let added = 0, removed = 0;
  if (ops) for (const o of ops) { if (o.type === "add") added++; else if (o.type === "del") removed++; }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Boot-script diff</h1>
        <p className="text-sm text-zinc-400">Unified diff between two boot scripts. Useful before re-applying.</p>
      </header>

      <form method="GET" className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
        <span className="text-zinc-400">A</span>
        <select name="a" defaultValue={sp.a ?? ""} className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1">
          <option value="">— select —</option>
          {scripts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}
        </select>
        <span className="text-zinc-400">→ B</span>
        <select name="b" defaultValue={sp.b ?? ""} className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1">
          <option value="">— select —</option>
          {scripts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}
        </select>
        <button type="submit" className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1">Diff</button>
        {ops && <span className="ml-2 text-emerald-400">+{added}</span>}
        {ops && <span className="text-rose-400">-{removed}</span>}
      </form>

      {!ops && <div className="text-sm text-zinc-500">Pick two scripts to compare.</div>}
      {ops && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
          <pre className="text-xs font-mono p-3 leading-relaxed">
            {ops.map((o, idx) => {
              const cls = o.type === "add" ? "text-emerald-300 bg-emerald-950/40"
                : o.type === "del" ? "text-rose-300 bg-rose-950/40"
                : "text-zinc-400";
              const sign = o.type === "add" ? "+ " : o.type === "del" ? "- " : "  ";
              return <div key={idx} className={cls}>{sign}{o.line}</div>;
            })}
          </pre>
        </div>
      )}
    </div>
  );
}
