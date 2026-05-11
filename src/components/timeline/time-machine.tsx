"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Clock, Loader2, Cpu, MemoryStick, ArrowDown, ArrowUp, Activity as ActivityIcon } from "lucide-react";
import { loadTimelineAction, listTimelineInstancesAction } from "@/server/actions/timeline";

interface Sample { t: number; cpu: number | null; mem: number | null; netIn: number | null; netOut: number | null; load1: number | null; }
interface Audit { t: number; action: string; status: string; message: string | null; }
interface Inst { id: string; name: string | null; provider: string; region: string; }

const RANGES = [
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "6h", ms: 6 * 60 * 60 * 1000 },
  { label: "24h", ms: 24 * 60 * 60 * 1000 },
  { label: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
];

export function TimeMachine() {
  const [insts, setInsts] = useState<Inst[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [rangeMs, setRangeMs] = useState(RANGES[2]!.ms);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [scrubT, setScrubT] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    void listTimelineInstancesAction().then((r) => {
      setInsts(r as Inst[]);
      if (r[0]) setSelected(r[0].id);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    const toMs = Date.now();
    const fromMs = toMs - rangeMs;
    start(async () => {
      const r = await loadTimelineAction({ instanceId: selected, fromMs, toMs });
      if (r.ok) {
        setSamples(r.samples);
        setAudits(r.audits);
        setScrubT(toMs);
      }
    });
  }, [selected, rangeMs]);

  const minT = samples[0]?.t ?? Date.now() - rangeMs;
  const maxT = samples[samples.length - 1]?.t ?? Date.now();
  const nearestSample = useMemo(() => {
    if (samples.length === 0) return null;
    let best = samples[0]!;
    let dBest = Math.abs(best.t - scrubT);
    for (const s of samples) {
      const d = Math.abs(s.t - scrubT);
      if (d < dBest) { dBest = d; best = s; }
    }
    return best;
  }, [samples, scrubT]);

  const nearbyAudits = useMemo(
    () => audits.filter((a) => Math.abs(a.t - scrubT) < rangeMs / 20).slice(0, 10),
    [audits, scrubT, rangeMs],
  );

  return (
    <div className="grid gap-4 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
          {insts.map((i) => <option key={i.id} value={i.id}>{i.name ?? i.id} · {i.provider} · {i.region}</option>)}
        </select>
        <div className="ml-2 flex gap-1">
          {RANGES.map((r) => (
            <button key={r.label} type="button" onClick={() => setRangeMs(r.ms)} className={`rounded px-2 py-1 ${rangeMs === r.ms ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : "border border-[var(--color-border)]"}`}>{r.label}</button>
          ))}
        </div>
        {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      </div>

      <SparkLine samples={samples} scrubT={scrubT} />

      <div className="flex items-center gap-3">
        <Clock className="h-3 w-3 text-muted" />
        <input
          type="range"
          min={minT}
          max={maxT}
          value={scrubT}
          onChange={(e) => setScrubT(Number(e.target.value))}
          className="flex-1 accent-[var(--color-primary)]"
        />
        <span className="font-mono text-[10px]">{new Date(scrubT).toLocaleString()}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric icon={<Cpu className="h-3 w-3" />} label="CPU" value={nearestSample?.cpu != null ? `${nearestSample.cpu.toFixed(1)}%` : "—"} />
        <Metric icon={<MemoryStick className="h-3 w-3" />} label="Mem" value={nearestSample?.mem != null ? `${nearestSample.mem.toFixed(1)}%` : "—"} />
        <Metric icon={<ArrowDown className="h-3 w-3" />} label="Net In" value={fmtBytes(nearestSample?.netIn)} />
        <Metric icon={<ArrowUp className="h-3 w-3" />} label="Net Out" value={fmtBytes(nearestSample?.netOut)} />
      </div>

      <section>
        <h3 className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted"><ActivityIcon className="h-3 w-3" /> Audit events near cursor</h3>
        {nearbyAudits.length === 0 ? (
          <p className="text-muted">No events within this slice.</p>
        ) : (
          <ul className="space-y-1">
            {nearbyAudits.map((a, i) => (
              <li key={i} className="flex gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1">
                <span className={`shrink-0 font-mono ${a.status === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{a.status === "ok" ? "✓" : "✗"}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted">{new Date(a.t).toLocaleTimeString()}</span>
                <span className="shrink-0 font-semibold">{a.action}</span>
                <span className="truncate text-muted">{a.message ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function fmtBytes(v: number | null | undefined): string {
  if (v == null) return "—";
  const units = ["B", "K", "M", "G"];
  let n = v; let i = 0;
  while (n > 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)}${units[i]}`;
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted">{icon}{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SparkLine({ samples, scrubT }: { samples: Sample[]; scrubT: number }) {
  if (samples.length < 2) return <div className="h-24 rounded border border-dashed border-[var(--color-border)] p-2 text-center text-muted">no samples in range</div>;
  const w = 800, h = 80;
  const minT = samples[0]!.t, maxT = samples[samples.length - 1]!.t;
  const span = Math.max(maxT - minT, 1);
  const path = (key: "cpu" | "mem") => {
    const pts = samples.map((s) => {
      const v = s[key] ?? 0;
      const x = ((s.t - minT) / span) * w;
      const y = h - (Math.min(v, 100) / 100) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${pts.join(" L")}`;
  };
  const scrubX = ((scrubT - minT) / span) * w;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-24 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)]" preserveAspectRatio="none">
      <path d={path("mem")} fill="none" stroke="var(--color-primary)" strokeOpacity="0.4" strokeWidth="1.5" />
      <path d={path("cpu")} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
      <line x1={scrubX} x2={scrubX} y1="0" y2={h} stroke="rgb(244 114 182)" strokeWidth="1.5" strokeDasharray="2,2" />
    </svg>
  );
}
