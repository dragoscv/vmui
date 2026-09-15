"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { BG_SOURCE_META, NOTIFY_APPS, SKIN_META, TURZX_BG_SOURCES, TURZX_SKINS, TURZX_VIEW_META, type OptionField, type TurzxBgSource, type TurzxSkin } from "@/lib/turzx/catalog";
import type { Pomodoro, TurzxBackground, TurzxSettings, TurzxViewConfig } from "@/lib/turzx/settings";
import { cn } from "@/lib/utils";
import { pomodoroAction, saveTurzxSettingsAction } from "@/server/actions/home";
import { ArrowDown, ArrowUp, BellRing, ChevronDown, ChevronUp, Coffee, Image as ImageIcon, MonitorSmartphone, Play, Square } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

const ACCENTS = ["#7c9cff", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#22d3ee", "#fb923c"];
const MIN_DWELL = 5;

/** View manager for the 3.5" Turzx desk screen driven by turzx/turzx.py. */
/** What the panel shows right now: the renderer writes its last pushed frame
 *  once a second, /api/turzx/mirror serves it. Refreshes only while visible. */
function LiveMirror() {
  const [tick, setTick] = React.useState(() => Date.now());
  const [ok, setOk] = React.useState(true);
  const [big, setBig] = React.useState(false);
  React.useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setTick(Date.now());
      setOk((o) => o || Date.now() % 10000 < 1000); // after a failure, retry roughly every 10 s
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="glass rounded-2xl p-4 sm:p-5 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">Oglindă live — exact ce e pe ecran acum</p>
        <button type="button" className="text-xs text-primary" onClick={() => setBig((b) => !b)} aria-pressed={big}>
          {big ? "1:1" : "2×"}
        </button>
      </div>
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element -- dynamic PNG, no optimisation wanted
        <img
          src={`/api/turzx/mirror?t=${tick}`}
          alt="Conținutul curent al ecranului Turzx"
          width={big ? 960 : 480}
          height={big ? 640 : 320}
          className="rounded-lg border border-border bg-black max-w-full h-auto"
          style={{ imageRendering: big ? "pixelated" : "auto" }}
          onError={() => setOk(false)}
          onLoad={() => setOk(true)}
        />
      ) : (
        <p className="text-sm text-muted">Renderer-ul nu rulează (task vmui-turzx) — nimic de arătat.</p>
      )}
    </div>
  );
}

export function TurzxCard({ initial, pomodoro }: { initial: TurzxSettings; pomodoro: Pomodoro }) {
  const [s, setS] = React.useState<TurzxSettings>(initial);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const setView = (id: string, patch: Partial<TurzxViewConfig>) => setS((p) => ({ ...p, views: p.views.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));
  const move = (id: string, dir: -1 | 1) =>
    setS((p) => {
      const i = p.views.findIndex((v) => v.id === id);
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

  const enabledCount = s.views.filter((v) => v.enabled).length;
  const cycleSec = s.views.filter((v) => v.enabled).reduce((a, v) => a + v.dwellSec, 0);

  return (
    <section className="space-y-5" aria-labelledby="turzx-h">
      <header className="glass rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <MonitorSmartphone className="size-5 text-primary" aria-hidden />
          <div>
            <h3 id="turzx-h" className="font-semibold">Ecranul Turzx 3.5"</h3>
            <p className="text-xs text-muted">{enabledCount} view-uri active · un ciclu complet {Math.round(cycleSec / 60)} min {cycleSec % 60} s</p>
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={!dirty || busy}>{busy ? "Saving…" : "Save"}</Button>
      </header>

      <PomodoroBar p={pomodoro} />

      <LiveMirror />

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-3">
        <p className="text-xs text-muted">View-uri — ordinea, durata, skin-ul și fundalul fiecăruia</p>
        <ul className="space-y-2">
          {s.views.map((v, i) => {
            const meta = TURZX_VIEW_META[v.id];
            const isOpen = open === v.id;
            return (
              <li key={v.id} className={cn("rounded-xl border transition", v.enabled ? "border-primary/40 bg-primary/5" : "border-border opacity-70")}>
                <div className="flex items-center gap-3 px-3 py-2">
                  <Switch checked={v.enabled} onCheckedChange={(on) => setView(v.id, { enabled: on })} aria-label={`${meta.label} activ`} />
                  <button type="button" className="flex-1 text-left min-w-0" onClick={() => setOpen(isOpen ? null : v.id)} aria-expanded={isOpen}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{meta.label}</span>
                      <Badge variant="muted">{v.dwellSec}s</Badge>
                      <Badge variant="muted">{SKIN_META[v.skin].label}</Badge>
                      {v.background?.mode === "photo" && <ImageIcon className="size-3.5 text-muted" aria-label="fundal foto propriu" />}
                    </div>
                    <p className="text-xs text-muted truncate">{meta.description}</p>
                  </button>
                  <span className="flex flex-col">
                    <button type="button" aria-label={`${meta.label} mai sus`} onClick={() => move(v.id, -1)} disabled={i === 0} className="disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label={`${meta.label} mai jos`} onClick={() => move(v.id, 1)} disabled={i === s.views.length - 1} className="disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                  </span>
                  <button type="button" onClick={() => setOpen(isOpen ? null : v.id)} aria-label={isOpen ? "închide" : "configurează"}>
                    {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </button>
                </div>
                {isOpen && (
                  <div className="border-t border-border px-3 py-3 grid gap-4 sm:grid-cols-2">
                    <Field label={`Durată · ${v.dwellSec} s`}>
                      <Slider min={MIN_DWELL} max={120} step={1} value={v.dwellSec} onChange={(n) => setView(v.id, { dwellSec: n })} aria-label="Durată" />
                    </Field>
                    <Field label="Skin">
                      <SkinPicker value={v.skin} allowed={meta.skins} onChange={(skin) => setView(v.id, { skin })} />
                    </Field>
                    <div className="sm:col-span-2">
                      <div className="flex items-center gap-3 text-sm mb-2">
                        <Switch checked={v.background !== null} onCheckedChange={(on) => setView(v.id, { background: on ? { ...s.background } : null })} aria-label="Fundal propriu" />
                        <span>{v.background ? "Fundal propriu pentru acest view" : "Folosește fundalul global"}</span>
                      </div>
                      {v.background && <BackgroundEditor value={v.background} onChange={(background) => setView(v.id, { background })} />}
                    </div>
                    {meta.options.length > 0 && (
                      <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
                        {meta.options.map((f) => (
                          <OptionInput key={f.key} field={f} value={v.options[f.key]} onChange={(val) => setView(v.id, { options: { ...v.options, [f.key]: val } })} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BellRing className="size-4 text-primary" aria-hidden />
            <p className="text-sm font-medium">Notificări de pe telefon</p>
          </div>
          <Switch checked={s.notify.enabled} onCheckedChange={(v) => setS({ ...s, notify: { ...s.notify, enabled: v } })} aria-label="Notificări active" />
        </div>
        <p className="text-xs text-muted">Un card cu aplicația, expeditorul și mesajul, peste view-ul curent, pentru câteva secunde. Sursa: senzorul „Last notification” din Home Assistant Companion (S25).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-3 text-sm">
            <Switch checked={s.notify.presenceOnly} onCheckedChange={(v) => setS({ ...s, notify: { ...s.notify, presenceOnly: v } })} aria-label="Doar când sunt la birou" />
            <span>Doar când senzorul de prezență mă vede la birou</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Switch checked={s.notify.showText} onCheckedChange={(v) => setS({ ...s, notify: { ...s.notify, showText: v } })} aria-label="Arată textul mesajului" />
            <span>{s.notify.showText ? "Arată și textul mesajului" : "Discret: doar aplicația + expeditorul"}</span>
          </div>
          <Field label="Poziție">
            <div className="flex gap-1.5">
              {(["top", "center", "bottom"] as const).map((p) => (
                <button key={p} type="button" aria-pressed={s.notify.position === p} onClick={() => setS({ ...s, notify: { ...s.notify, position: p } })} className={cn("rounded-lg border px-2.5 py-1 text-xs", s.notify.position === p ? "border-primary bg-primary/15" : "border-border text-muted")}>
                  {p === "top" ? "Sus" : p === "center" ? "Centru" : "Jos"}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`Durată card · ${s.notify.durationSec} s`}>
            <Slider min={2} max={30} step={1} value={s.notify.durationSec} onChange={(n) => setS({ ...s, notify: { ...s.notify, durationSec: n } })} aria-label="Durată card" />
          </Field>
        </div>
        <div>
          <p className="text-xs text-muted mb-2">Aplicații afișate (lista trebuie să coincidă cu Allow list din Companion)</p>
          <div className="flex flex-wrap gap-1.5">
            {NOTIFY_APPS.map((a) => {
              const on = s.notify.packages.includes(a.pkg);
              return (
                <button key={a.pkg} type="button" aria-pressed={on} onClick={() => setS({ ...s, notify: { ...s.notify, packages: on ? s.notify.packages.filter((p) => p !== a.pkg) : [...s.notify.packages, a.pkg] } })} className={cn("rounded-lg border px-2.5 py-1 text-xs flex items-center gap-1.5", on ? "border-primary bg-primary/15" : "border-border text-muted")}>
                  <span className="size-2.5 rounded-full" style={{ background: a.color }} aria-hidden />
                  {a.label}
                </button>
              );
            })}
          </div>
          <textarea
            value={s.notify.packages.filter((p) => !NOTIFY_APPS.some((a) => a.pkg === p)).join("\n")}
            onChange={(e) => setS({ ...s, notify: { ...s.notify, packages: [...s.notify.packages.filter((p) => NOTIFY_APPS.some((a) => a.pkg === p)), ...e.target.value.split(/\n|,/).map((x) => x.trim()).filter(Boolean)] } })}
            placeholder="alte pachete Android, unul pe linie (ex. com.example.app)"
            rows={2}
            aria-label="Alte pachete"
            className="mt-2 w-full rounded-lg border border-border bg-surface px-2 py-1 text-xs"
          />
        </div>
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-4">
        <p className="text-xs text-muted">Fundal global (view-urile fără fundal propriu)</p>
        <BackgroundEditor value={s.background} onChange={(background) => setS({ ...s, background })} />
        <Field label={`Schimbă poza la · ${s.bgRotateMin} min`}>
          <Slider min={1} max={240} step={1} value={s.bgRotateMin} onChange={(n) => setS({ ...s, bgRotateMin: n })} aria-label="Interval schimbare fundal" />
        </Field>
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5 grid gap-4 sm:grid-cols-2">
        <Field label={`Fluiditate · ${s.fps} fps`}>
          <Slider min={5} max={30} step={1} value={s.fps} onChange={(n) => setS({ ...s, fps: n })} aria-label="FPS" />
        </Field>
        <Field label={`Tranziție · ${s.transitionMs} ms`}>
          <Slider min={0} max={1500} step={50} value={s.transitionMs} onChange={(n) => setS({ ...s, transitionMs: n })} aria-label="Tranziție" />
        </Field>
        <Field label={`Luminozitate zi · ${s.brightness}%`}>
          <Slider min={5} max={100} step={5} value={s.brightness} onChange={(n) => setS({ ...s, brightness: n })} aria-label="Luminozitate zi" />
        </Field>
        <Field label={`Luminozitate noapte · ${s.nightBrightness}%`}>
          <Slider min={0} max={100} step={5} value={s.nightBrightness} onChange={(n) => setS({ ...s, nightBrightness: n })} aria-label="Luminozitate noapte" />
        </Field>
        <Field label="Interval noapte">
          <div className="flex items-center gap-2 text-sm">
            <input type="time" value={s.nightFrom} onChange={(e) => setS({ ...s, nightFrom: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1" aria-label="Noapte de la" />
            <span className="text-muted">→</span>
            <input type="time" value={s.nightTo} onChange={(e) => setS({ ...s, nightTo: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1" aria-label="Noapte până la" />
          </div>
        </Field>
        <Field label="Orientare">
          <div className="flex items-center gap-3 text-sm">
            <Switch checked={s.flip} onCheckedChange={(v) => setS({ ...s, flip: v })} aria-label="Rotit 180°" />
            <span>{s.flip ? "Rotit 180° (cablu pe cealaltă parte)" : "Normal"}</span>
          </div>
        </Field>
        <div className="sm:col-span-2">
          <p className="text-xs text-muted mb-2">Culoare accent</p>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((c) => (
              <button key={c} type="button" aria-label={`accent ${c}`} aria-pressed={s.accent === c} onClick={() => setS({ ...s, accent: c })} className={cn("size-8 rounded-full ring-offset-2 ring-offset-bg transition", s.accent === c && "ring-2 ring-fg")} style={{ background: c }} />
            ))}
            <input type="color" value={s.accent} onChange={(e) => setS({ ...s, accent: e.target.value })} aria-label="accent personalizat" className="size-8 rounded-full border-0 bg-transparent" />
          </div>
        </div>
      </div>
    </section>
  );
}

function SkinPicker({ value, allowed, onChange }: { value: TurzxSkin; allowed: TurzxSkin[]; onChange: (s: TurzxSkin) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TURZX_SKINS.filter((k) => allowed.includes(k)).map((k) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)} title={SKIN_META[k].description} className={cn("rounded-lg border px-2.5 py-1 text-xs transition", value === k ? "border-primary bg-primary/15 text-fg" : "border-border text-muted hover:text-fg")}>
          {SKIN_META[k].label}
        </button>
      ))}
    </div>
  );
}

function BackgroundEditor({ value, onChange }: { value: TurzxBackground; onChange: (b: TurzxBackground) => void }) {
  const toggleSrc = (src: TurzxBgSource) => onChange({ ...value, sources: value.sources.includes(src) ? value.sources.filter((x) => x !== src) : [...value.sources, src] });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["none", "photo"] as const).map((m) => (
          <button key={m} type="button" aria-pressed={value.mode === m} onClick={() => onChange({ ...value, mode: m })} className={cn("rounded-lg border px-2.5 py-1 text-xs", value.mode === m ? "border-primary bg-primary/15" : "border-border text-muted")}>
            {m === "none" ? "Culoare plată" : "Poze"}
          </button>
        ))}
      </div>
      {value.mode === "photo" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {TURZX_BG_SOURCES.map((src) => (
              <button key={src} type="button" aria-pressed={value.sources.includes(src)} onClick={() => toggleSrc(src)} title={BG_SOURCE_META[src].description} className={cn("rounded-lg border px-2.5 py-1 text-xs", value.sources.includes(src) ? "border-primary bg-primary/15" : "border-border text-muted")}>
                {BG_SOURCE_META[src].label}
              </button>
            ))}
          </div>
          {value.sources.includes("folder") && (
            <Input value={value.folder} onChange={(e) => onChange({ ...value, folder: e.target.value })} placeholder="D:\Poze\Wallpapers" aria-label="Folder cu imagini" />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Întunecare · ${Math.round(value.dim * 100)}%`}>
              <Slider min={0} max={90} step={5} value={Math.round(value.dim * 100)} onChange={(n) => onChange({ ...value, dim: n / 100 })} aria-label="Întunecare fundal" />
            </Field>
            <Field label={`Blur · ${value.blur}`}>
              <Slider min={0} max={12} step={1} value={value.blur} onChange={(n) => onChange({ ...value, blur: n })} aria-label="Blur fundal" />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

function OptionInput({ field, value, onChange }: { field: OptionField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case "toggle":
      return (
        <div className="flex items-center gap-3 text-sm">
          <Switch checked={value === undefined ? Boolean(field.default) : Boolean(value)} onCheckedChange={onChange} aria-label={field.label} />
          <span>{field.label}</span>
        </div>
      );
    case "number":
      return (
        <Field label={`${field.label} · ${typeof value === "number" ? value : "—"}`}>
          <Slider min={field.min} max={field.max} step={field.step ?? 1} value={typeof value === "number" ? value : field.min} onChange={onChange} aria-label={field.label} />
        </Field>
      );
    case "select":
      return (
        <Field label={field.label}>
          <Select value={typeof value === "string" ? value : field.choices[0]?.value} onValueChange={onChange}>
            <SelectTrigger aria-label={field.label}><SelectValue /></SelectTrigger>
            <SelectContent>
              {field.choices.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      );
    case "list":
      return (
        <Field label={field.label}>
          <textarea
            value={Array.isArray(value) ? value.join("\n") : ""}
            onChange={(e) => onChange(e.target.value.split(/\n|,/).map((x) => x.trim()).filter(Boolean))}
            placeholder={field.placeholder}
            rows={3}
            aria-label={field.label}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-sm"
          />
          {field.hint && <p className="text-[11px] text-muted">{field.hint}</p>}
        </Field>
      );
    default:
      return (
        <Field label={field.label}>
          <Input value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} aria-label={field.label} />
        </Field>
      );
  }
}

function PomodoroBar({ p }: { p: Pomodoro }) {
  const [busy, setBusy] = React.useState(false);
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    if (p.phase === "idle") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [p.phase]);
  const left = Math.max(0, p.endsAt - Date.now());
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  const act = async (cmd: "start" | "break" | "stop") => {
    setBusy(true);
    const r = await pomodoroAction(cmd);
    setBusy(false);
    if (!r.ok) toast.error(r.error ?? "Failed");
  };
  return (
    <div className="glass rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Coffee className="size-5 text-primary" aria-hidden />
        <div>
          <p className="text-sm font-medium">Pomodoro {p.phase !== "idle" && <span className="text-muted">· runda {p.round}</span>}</p>
          <p className="text-xs text-muted">{p.phase === "idle" ? "oprit — apare pe ecran doar când rulează" : `${p.phase === "work" ? "lucru" : "pauză"} · ${mm}:${String(ss).padStart(2, "0")} rămase`}</p>
        </div>
      </div>
      <div className="flex gap-2">
        {p.phase !== "work" && <Button size="sm" onClick={() => act("start")} disabled={busy}><Play className="size-3.5" /> Lucru</Button>}
        {p.phase === "work" && <Button size="sm" variant="secondary" onClick={() => act("break")} disabled={busy}><Coffee className="size-3.5" /> Pauză</Button>}
        {p.phase !== "idle" && <Button size="sm" variant="ghost" onClick={() => act("stop")} disabled={busy}><Square className="size-3.5" /> Stop</Button>}
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
