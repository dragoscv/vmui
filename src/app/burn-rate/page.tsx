import "server-only";
import { computeBurnRate, getBurnRateThreshold, setBurnRateThreshold } from "@/lib/burn-rate";
import { requireRole } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function saveThreshold(formData: FormData) {
  "use server";
  await requireRole("admin");
  await setBurnRateThreshold(Number(formData.get("threshold") ?? 0));
  revalidatePath("/burn-rate");
}

export default async function BurnRatePage() {
  const [report, threshold] = await Promise.all([computeBurnRate(), getBurnRateThreshold()]);
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
    </div>
  );
}
