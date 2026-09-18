"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DISPLAY_VIEW_META, type DisplaySettings, type DisplayView } from "@/lib/display/settings-meta";
import { BG_SOURCE_META, TURZX_BG_SOURCES, type TurzxBgSource } from "@/lib/turzx/catalog";
import { cn } from "@/lib/utils";
import { saveDisplaySettingsAction } from "@/server/actions/home";
import { ArrowDown, ArrowUp, ExternalLink, Tablet } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

const ACCENTS = ["#f2b85a", "#7c9cff", "#34d399", "#f472b6", "#a78bfa", "#22d3ee", "#fb923c"];

/** Settings for the Nest Hub kiosk (/display). Saved to the same table as Turzx, row 4. */
export function DisplayCard({ initial, espToken }: { initial: DisplaySettings; espToken: string }) {
  const [s, setS] = React.useState<DisplaySettings>(initial);
  const [busy, setBusy] = React.useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const setView = (id: string, patch: Partial<DisplayView>) => setS((p) => ({ ...p, views: p.views.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  const move = (id: string, dir: -1 | 1) =>
    setS((p) => {
      const i = p.views.findIndex((v) => v.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.views.length) return p;
      const next = [...p.views];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return { ...p, views: next };
    });
  const toggleSource = (src: TurzxBgSource) =>
    setS((p) => ({ ...p, photoSources: p.photoSources.includes(src) ? p.photoSources.filter((x) => x !== src) : [...p.photoSources, src] }));

  const save = async () => {
    setBusy(true);
    const r = await saveDisplaySettingsAction(s);
    setBusy(false);
    if (!r.ok) toast.error(r.error ?? "Failed");
    else toast.success("Nest Hub actualizat — ecranul urmează în câteva secunde");
  };

  const on = s.views.filter((v) => v.enabled);
  const cycle = on.reduce((a, v) => a + v.dwellSec, 0);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/display?k=${espToken}`;

  return (
    <section className="space-y-5" aria-labelledby="display-h">
      <header className="glass rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Tablet className="size-5 text-primary" aria-hidden />
          <div>
            <h3 id="display-h" className="font-semibold">Nest Hub · dormitor</h3>
            <p className="text-xs text-muted">{on.length} panouri în idle · un ciclu {Math.round(cycle / 60)} min {cycle % 60} s · poză nouă la {s.photoSec} s</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {url ? (
            <Button size="sm" variant="ghost" asChild>
              <a href={url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden /> Deschide /display</a>
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={!dirty || busy}>{busy ? "Se salvează…" : "Salvează"}</Button>
        </div>
      </header>

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-3">
        <p className="text-xs text-muted">Panouri idle — ordinea, durata și dacă au fotografie în spate. Muzica apare automat când cântă ceva.</p>
        <ul className="space-y-2">
          {s.views.map((v, i) => {
            const meta = DISPLAY_VIEW_META[v.id];
            return (
              <li key={v.id} className={cn("rounded-xl border px-3 py-2 flex flex-wrap items-center gap-3 transition", v.enabled ? "border-primary/40 bg-primary/5" : "border-border opacity-70")}>
                <Switch checked={v.enabled} onCheckedChange={(en) => setView(v.id, { enabled: en })} aria-label={`${meta.label} activ`} />
                <div className="flex-1 min-w-40">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{meta.label}</span>
                    <Badge variant="muted">{v.dwellSec}s</Badge>
                  </div>
                  <p className="text-xs text-muted">{meta.description}</p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <Switch checked={v.photo} onCheckedChange={(ph) => setView(v.id, { photo: ph })} aria-label={`${meta.label} cu fotografie`} />
                  foto
                </label>
                <div className="w-36">
                  <Slider value={v.dwellSec} min={5} max={180} step={5} onChange={(n) => setView(v.id, { dwellSec: n })} aria-label={`Durată ${meta.label}`} />
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="Mută sus" onClick={() => move(v.id, -1)} disabled={i === 0}><ArrowUp className="size-4" /></Button>
                  <Button size="icon" variant="ghost" aria-label="Mută jos" onClick={() => move(v.id, 1)} disabled={i === s.views.length - 1}><ArrowDown className="size-4" /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="glass rounded-2xl p-4 sm:p-5 space-y-4">
          <p className="text-xs text-muted">Fotografii</p>
          <div className="flex flex-wrap gap-2">
            {TURZX_BG_SOURCES.map((src) => {
              const active = s.photoSources.includes(src);
              return (
                <button key={src} type="button" onClick={() => toggleSource(src)} aria-pressed={active} title={BG_SOURCE_META[src].description}
                  className={cn("rounded-full border px-3 py-1 text-xs transition", active ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted")}>
                  {BG_SOURCE_META[src].label}
                </button>
              );
            })}
          </div>
          <Field label={`Schimbă poza la · ${s.photoSec} s`}>
            <Slider value={s.photoSec} min={10} max={300} step={5} onChange={(n) => setS((p) => ({ ...p, photoSec: n }))} />
          </Field>
          <Field label={`Întunecare peste poză · ${Math.round(s.dim * 100)}%`}>
            <Slider value={s.dim} min={0} max={0.9} step={0.05} onChange={(n) => setS((p) => ({ ...p, dim: n }))} />
          </Field>
          <Field label="Accent">
            <div className="flex flex-wrap items-center gap-2">
              {ACCENTS.map((c) => (
                <button key={c} type="button" aria-label={`Accent ${c}`} aria-pressed={s.accent === c} onClick={() => setS((p) => ({ ...p, accent: c }))}
                  className={cn("size-7 rounded-full border-2 transition", s.accent === c ? "border-foreground scale-110" : "border-transparent")} style={{ background: c }} />
              ))}
              <Input type="color" value={s.accent} onChange={(e) => setS((p) => ({ ...p, accent: e.target.value }))} className="h-8 w-12 p-1" aria-label="Accent personalizat" />
            </div>
          </Field>
        </div>

        <div className="glass rounded-2xl p-4 sm:p-5 space-y-4">
          <p className="text-xs text-muted">Comportament</p>
          <Field label={`Înapoi în idle după · ${s.idleAfterSec} s fără atingere`}>
            <Slider value={s.idleAfterSec} min={10} max={300} step={5} onChange={(n) => setS((p) => ({ ...p, idleAfterSec: n }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Noapte de la">
              <Input type="time" value={s.nightFrom} onChange={(e) => setS((p) => ({ ...p, nightFrom: e.target.value }))} />
            </Field>
            <Field label="până la">
              <Input type="time" value={s.nightTo} onChange={(e) => setS((p) => ({ ...p, nightTo: e.target.value }))} />
            </Field>
          </div>
          <Field label={`Luminozitate noaptea · ${Math.round(s.nightDim * 100)}%`}>
            <Slider value={s.nightDim} min={0.05} max={1} step={0.05} onChange={(n) => setS((p) => ({ ...p, nightDim: n }))} />
          </Field>
          <Field label="Dispozitiv Cast">
            <Input value={s.cast.device} onChange={(e) => setS((p) => ({ ...p, cast: { ...p.cast, device: e.target.value } }))} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Re-trimite pagina când Hub-ul o pierde <span className="text-xs text-muted">(hub-cast pe Pi)</span></span>
            <Switch checked={s.cast.keepAlive} onCheckedChange={(on) => setS((p) => ({ ...p, cast: { ...p.cast, keepAlive: on } }))} />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Nu întrerupe YouTube / Spotify pe Hub</span>
            <Switch checked={s.cast.respectPlayback} onCheckedChange={(on) => setS((p) => ({ ...p, cast: { ...p.cast, respectPlayback: on } }))} />
          </label>
        </div>
      </div>
    </section>
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
