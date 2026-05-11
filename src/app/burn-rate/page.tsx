import "server-only";
import { computeBurnRate, getBurnRateThreshold, setBurnRateThreshold } from "@/lib/burn-rate";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";

export const dynamic = "force-dynamic";

async function saveThreshold(formData: FormData) {
  "use server";
  await requireRole("admin");
  await setBurnRateThreshold(Number(formData.get("threshold") ?? 0));
  revalidatePath("/burn-rate");
}

export default async function BurnRatePage() {
  const [report, threshold] = await Promise.all([computeBurnRate(), getBurnRateThreshold()]);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const snaps = await db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since));
  // Aggregate per-day max hourly per account, then sum across accounts.
  const byDay = new Map<string, Map<string, number>>(); // day -> account -> hourly
  for (const s of snaps) {
    const day = s.capturedAt.toISOString().slice(0, 10);
    let m = byDay.get(day);
    if (!m) { m = new Map(); byDay.set(day, m); }
    const cur = m.get(s.accountId) ?? 0;
    if (s.hourlyUsd > cur) m.set(s.accountId, s.hourlyUsd);
  }
  const days = Array.from(byDay.entries())
    .map(([day, m]) => ({ day, daily: Array.from(m.values()).reduce((a, b) => a + b, 0) * 24 }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const max = Math.max(threshold, ...days.map((d) => d.daily), 1);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Burn rate guard</h1>
        <p className="text-sm text-zinc-400">Alert when projected daily spend exceeds a threshold.</p>
      </header>

      <div className={`rounded-lg border p-6 ${report.exceeded ? "border-rose-500/40 bg-rose-950/30" : "border-zinc-800 bg-zinc-950"}`}>
        <div className="grid grid-cols-3 gap-6 text-sm">
          <div>
            <div className="text-xs uppercase text-zinc-500">Projected daily</div>
            <div className="mt-1 text-2xl font-semibold">${report.projectedDailyUsd.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-zinc-500">Projected monthly</div>
            <div className="mt-1 text-2xl font-semibold">${report.projectedMonthlyUsd.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-zinc-500">Threshold (daily)</div>
            <div className="mt-1 text-2xl font-semibold">{threshold > 0 ? `$${threshold.toFixed(2)}` : "—"}</div>
          </div>
        </div>
        {report.exceeded && (
          <div className="mt-4 text-sm text-rose-200">⚠ Daily burn rate is above your threshold.</div>
        )}
      </div>

      <form action={saveThreshold} className="flex items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div>
          <label className="text-xs uppercase text-zinc-500">Threshold (USD/day)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            name="threshold"
            defaultValue={threshold}
            className="mt-1 block w-48 rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
          />
        </div>
        <button type="submit" className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-sm">Save</button>
        <span className="text-xs text-zinc-500">Set 0 to disable.</span>
      </form>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-sm font-medium mb-3">Last 30 days · projected daily burn</h2>
        {days.length === 0 ? (
          <p className="text-sm text-zinc-500">Not enough history yet.</p>
        ) : (
          <svg viewBox="0 0 600 160" className="w-full">
            {threshold > 0 && (
              <line x1="0" y1={150 - (threshold / max) * 140} x2="600" y2={150 - (threshold / max) * 140} stroke="#f43f5e" strokeDasharray="4 4" strokeWidth="1" />
            )}
            <polyline
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
              points={days.map((d, i) => `${(i / Math.max(days.length - 1, 1)) * 590 + 5},${150 - (d.daily / max) * 140}`).join(" ")}
            />
            {days.map((d, i) => {
              const x = (i / Math.max(days.length - 1, 1)) * 590 + 5;
              const y = 150 - (d.daily / max) * 140;
              const over = threshold > 0 && d.daily > threshold;
              return <circle key={d.day} cx={x} cy={y} r={over ? 4 : 2.5} fill={over ? "#f43f5e" : "#34d399"}><title>{`${d.day}: $${d.daily.toFixed(2)}`}</title></circle>;
            })}
          </svg>
        )}
      </section>
    </div>
  );
}
