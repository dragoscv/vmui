"use client";
import { useState, useEffect, useRef } from "react";

interface Sample { t: number; cpu?: number; mem?: number; }

export function AnomalyPlaybackClient({ samples }: { samples: Sample[] }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(120);
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      setIdx((i) => (i + 1) % Math.max(1, samples.length));
    }, Math.max(20, 1000 / speed));
    return () => clearInterval(interval);
  }, [playing, speed, samples.length]);

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const W = c.width, H = c.height;
    ctx.fillStyle = "rgb(9 9 11)"; ctx.fillRect(0, 0, W, H);
    if (samples.length < 2) return;
    const slice = samples.slice(0, idx + 1);
    const t0 = samples[0]!.t; const tN = samples[samples.length - 1]!.t;
    const sx = (t: number) => ((t - t0) / Math.max(1, tN - t0)) * (W - 20) + 10;
    const sy = (v: number) => H - 10 - (v / 100) * (H - 20);
    function plot(field: "cpu" | "mem", color: string) {
      ctx!.beginPath();
      ctx!.strokeStyle = color; ctx!.lineWidth = 1.5;
      let started = false;
      for (const s of slice) {
        const v = s[field];
        if (typeof v !== "number") continue;
        const x = sx(s.t), y = sy(v);
        if (!started) { ctx!.moveTo(x, y); started = true; } else ctx!.lineTo(x, y);
      }
      ctx!.stroke();
    }
    plot("cpu", "rgb(52 211 153)");
    plot("mem", "rgb(96 165 250)");

    const cur = samples[idx];
    if (cur) {
      ctx.strokeStyle = "rgb(244 63 94)"; ctx.lineWidth = 1;
      const x = sx(cur.t);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
  }, [idx, samples]);

  const cur = samples[idx];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <canvas ref={ref} width={900} height={260} className="w-full" />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button onClick={() => setPlaying((p) => !p)} className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1">{playing ? "Pause" : "Play"}</button>
        <button onClick={() => setIdx(0)} className="rounded-md border border-zinc-700 px-2 py-1">Restart</button>
        <label className="text-xs text-zinc-400 flex items-center gap-2">Speed
          <input type="range" min={20} max={400} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          <span className="font-mono">{speed}/s</span>
        </label>
        <input type="range" min={0} max={Math.max(0, samples.length - 1)} value={idx} onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} className="flex-1 min-w-[200px]" />
      </div>
      {cur && (
        <div className="text-xs text-zinc-400 font-mono">
          {new Date(cur.t).toLocaleString()} · cpu={cur.cpu?.toFixed(1) ?? "—"}% mem={cur.mem?.toFixed(1) ?? "—"}%
        </div>
      )}
      <div className="text-xs flex gap-3"><span className="text-emerald-400">— CPU</span><span className="text-blue-400">— Memory</span></div>
    </div>
  );
}
