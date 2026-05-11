"use client";
import { useState, useTransition } from "react";
import type { QuietHoursConfig } from "@/lib/quiet-hours";
import { saveQuietHoursAction } from "@/server/actions/extras";

const SEVERITIES: ("error" | "warning" | "success" | "info")[] = ["error", "warning", "success", "info"];

export function QuietHoursPanel({ initial }: { initial: QuietHoursConfig }) {
  const [cfg, setCfg] = useState<QuietHoursConfig>(initial);
  const [pending, start] = useTransition();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function save() {
    start(async () => {
      await saveQuietHoursAction(cfg);
      setSavedAt(new Date());
    });
  }
  function toggleSev(s: typeof SEVERITIES[number]) {
    setCfg((c) => ({ ...c, allowSeverities: c.allowSeverities.includes(s) ? c.allowSeverities.filter((x) => x !== s) : [...c.allowSeverities, s] }));
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
        Enable quiet hours
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs space-y-1"><span className="text-zinc-400">Start</span>
          <input type="time" value={cfg.startHHMM} onChange={(e) => setCfg({ ...cfg, startHHMM: e.target.value })} className="block w-full rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm" />
        </label>
        <label className="text-xs space-y-1"><span className="text-zinc-400">End</span>
          <input type="time" value={cfg.endHHMM} onChange={(e) => setCfg({ ...cfg, endHHMM: e.target.value })} className="block w-full rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-sm" />
        </label>
      </div>
      <div className="text-xs space-y-1">
        <div className="text-zinc-400">Always allow these severities through</div>
        <div className="flex flex-wrap gap-2">
          {SEVERITIES.map((s) => (
            <label key={s} className="flex items-center gap-1 rounded border border-zinc-800 px-2 py-0.5">
              <input type="checkbox" checked={cfg.allowSeverities.includes(s)} onChange={() => toggleSev(s)} />
              {s}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500">{savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : ""}</span>
        <button onClick={save} disabled={pending} className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1">Save</button>
      </div>
    </div>
  );
}
