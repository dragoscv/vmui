import "server-only";
import { db } from "@/lib/db";
import { snapshotHistory } from "@/lib/db/schema";
import { gte } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function SpendHeatmapPage() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const snaps = await db.select().from(snapshotHistory).where(gte(snapshotHistory.capturedAt, since));

  const cells = new Map<string, { sum: number; n: number }>();
  for (const s of snaps) {
    const dow = s.capturedAt.getUTCDay();
    const hour = s.capturedAt.getUTCHours();
    const k = `${dow}:${hour}`;
    const cur = cells.get(k) ?? { sum: 0, n: 0 };
    cur.sum += s.hourlyUsd; cur.n += 1;
    cells.set(k, cur);
  }
  let max = 0;
  for (const v of cells.values()) max = Math.max(max, v.n > 0 ? v.sum / v.n : 0);

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Spend heatmap</h1>
        <p className="text-sm text-zinc-400">Mean hourly spend by hour-of-day × day-of-week (UTC, last 30 days).</p>
      </header>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0.5">
          <thead>
            <tr><th className="px-1 text-zinc-500">UTC</th>{Array.from({ length: 24 }, (_, h) => <th key={h} className="px-1 text-zinc-500 text-center w-7">{h}</th>)}</tr>
          </thead>
          <tbody>
            {days.map((d, dow) => (
              <tr key={d}>
                <td className="px-1 text-zinc-500 font-medium">{d}</td>
                {Array.from({ length: 24 }, (_, h) => {
                  const c = cells.get(`${dow}:${h}`);
                  const mean = c && c.n > 0 ? c.sum / c.n : 0;
                  const intensity = max > 0 ? mean / max : 0;
                  const alpha = 0.05 + intensity * 0.85;
                  return (
                    <td key={h} title={`$${mean.toFixed(4)}/h (${c?.n ?? 0} samples)`}
                      style={{ background: `rgba(52,211,153,${alpha})` }}
                      className="w-7 h-7 rounded-sm text-center text-[10px] font-mono text-zinc-200/80">
                      {mean > 0 ? mean.toFixed(2) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-zinc-500">Brighter green = higher mean USD/hour. Peak: ${max.toFixed(4)}/h</div>
      </div>
    </div>
  );
}
