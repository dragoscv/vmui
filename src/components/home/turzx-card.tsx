"use client";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { TurzxSettings, TurzxView } from "@/lib/turzx/settings";
import { cn } from "@/lib/utils";
import { saveTurzxSettingsAction } from "@/server/actions/home";
import { ArrowDown, ArrowUp, MonitorSmartphone } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

const VIEW_LABEL: Record<TurzxView, string> = {
  clock: "Ceas",
  weather: "Vremea",
  home: "Acasă",
  ambilight: "Ambilight",
  pc: "PC",
  activity: "Activitate",
  media: "Redare",
  lists: "Liste",
};
const ALL: TurzxView[] = ["clock", "weather", "home", "ambilight", "pc", "activity", "media", "lists"];
const ACCENTS = ["#7c9cff", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#22d3ee", "#fb923c"];

/** Preferences for the 3.5" Turzx desk screen driven by turzx/turzx.py. */
export function TurzxCard({ initial }: { initial: TurzxSettings }) {
  const [s, setS] = React.useState<TurzxSettings>(initial);
  const [busy, setBusy] = React.useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const toggle = (v: TurzxView) =>
    setS((p) => ({ ...p, views: p.views.includes(v) ? (p.views.length > 1 ? p.views.filter((x) => x !== v) : p.views) : [...p.views, v] }));
  const move = (v: TurzxView, dir: -1 | 1) =>
    setS((p) => {
      const i = p.views.indexOf(v);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.views.length) return p;
      const next = [...p.views];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...p, views: next };
    });

  const save = async () => {
    setBusy(true);
    const r = await saveTurzxSettingsAction(s);
    setBusy(false);
    if (!r.ok) toast.error(r.error ?? "Failed");
    else toast.success("Turzx updated — screen follows in a few seconds");
  };

  return (
    <div className="glass rounded-2xl p-4 sm:p-5 space-y-5" aria-labelledby="turzx-h">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="size-5 text-primary" aria-hidden />
          <h3 id="turzx-h" className="font-semibold">Ecranul Turzx 3.5"</h3>
        </div>
        <Button size="sm" onClick={save} disabled={!dirty || busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>

      <div>
        <p className="text-xs text-muted mb-2">View-uri și ordinea lor</p>
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[...s.views, ...ALL.filter((v) => !s.views.includes(v))].map((v) => {
            const on = s.views.includes(v);
            const i = s.views.indexOf(v);
            return (
              <li key={v} className={cn("rounded-xl border px-3 py-2 text-sm flex items-center justify-between gap-1", on ? "border-primary/50 bg-primary/10" : "border-border opacity-60")}>
                <button type="button" onClick={() => toggle(v)} aria-pressed={on} className="flex-1 text-left">
                  {on ? `${i + 1}. ` : ""}{VIEW_LABEL[v]}
                </button>
                {on && (
                  <span className="flex flex-col">
                    <button type="button" aria-label={`${VIEW_LABEL[v]} mai sus`} onClick={() => move(v, -1)} disabled={i === 0} className="disabled:opacity-30"><ArrowUp className="size-3" /></button>
                    <button type="button" aria-label={`${VIEW_LABEL[v]} mai jos`} onClick={() => move(v, 1)} disabled={i === s.views.length - 1} className="disabled:opacity-30"><ArrowDown className="size-3" /></button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Durată view · ${s.dwellSec} s`}>
          <Slider min={3} max={60} step={1} value={s.dwellSec} onChange={(v) => setS({ ...s, dwellSec: v })} aria-label="Durată view" />
        </Field>
        <Field label={`Fluiditate · ${s.fps} fps`}>
          <Slider min={5} max={30} step={1} value={s.fps} onChange={(v) => setS({ ...s, fps: v })} aria-label="FPS" />
        </Field>
        <Field label={`Tranziție · ${s.transitionMs} ms`}>
          <Slider min={0} max={1500} step={50} value={s.transitionMs} onChange={(v) => setS({ ...s, transitionMs: v })} aria-label="Tranziție" />
        </Field>
        <Field label={`Luminozitate zi · ${s.brightness}%`}>
          <Slider min={5} max={100} step={5} value={s.brightness} onChange={(v) => setS({ ...s, brightness: v })} aria-label="Luminozitate zi" />
        </Field>
        <Field label={`Luminozitate noapte · ${s.nightBrightness}%`}>
          <Slider min={0} max={100} step={5} value={s.nightBrightness} onChange={(v) => setS({ ...s, nightBrightness: v })} aria-label="Luminozitate noapte" />
        </Field>
        <Field label="Interval noapte">
          <div className="flex items-center gap-2 text-sm">
            <input type="time" value={s.nightFrom} onChange={(e) => setS({ ...s, nightFrom: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1" aria-label="Noapte de la" />
            <span className="text-muted">→</span>
            <input type="time" value={s.nightTo} onChange={(e) => setS({ ...s, nightTo: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1" aria-label="Noapte până la" />
          </div>
        </Field>
      </div>

      <div>
        <p className="text-xs text-muted mb-2">Culoare accent</p>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`accent ${c}`}
              aria-pressed={s.accent === c}
              onClick={() => setS({ ...s, accent: c })}
              className={cn("size-8 rounded-full ring-offset-2 ring-offset-bg transition", s.accent === c && "ring-2 ring-fg")}
              style={{ background: c }}
            />
          ))}
          <input type="color" value={s.accent} onChange={(e) => setS({ ...s, accent: e.target.value })} aria-label="accent personalizat" className="size-8 rounded-full border-0 bg-transparent" />
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
