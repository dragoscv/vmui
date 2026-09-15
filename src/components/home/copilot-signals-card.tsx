"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { COPILOT_EVENTS, type CopilotEvent, type CopilotSignals } from "@/lib/copilot/signals-schema";
import { cn } from "@/lib/utils";
import { saveCopilotSignalsAction, testCopilotSignalAction } from "@/server/actions/home";
import { Bot, Lightbulb, MonitorSmartphone, Play, Radio, Sparkles } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

const EVENT_META: Record<CopilotEvent, { label: string; hint: string }> = {
  ask: { label: "Așteaptă răspuns", hint: "askQuestions — becuri: puls agresiv; bandă: un punct luminos aleargă pe ramă până răspunzi" },
  done: { label: "Tură terminată", hint: "Stop — becuri: fade calm; bandă: val verde urcă pe ambele laturi și se stinge" },
  blocked: { label: "Comandă blocată", hint: "guard (git add -A, reset --hard…) — becuri: 3 flash-uri; bandă: 2 unde roșii din mijlocul de sus" },
  failed: { label: "Build/test eșuat", hint: "run-build.ps1 exit ≠ 0 — becuri: 2 flash-uri; bandă: 2 clipiri duble galbene" },
};

/** Physical signals for agent-harness events: room bulbs, turzx card, ESP32.
 *  Fired by ~/.copilot/hooks -> POST /api/copilot/event. */
export function CopilotSignalsCard({ initial, lights }: { initial: CopilotSignals; lights: Array<{ id: string; name: string }> }) {
  const [s, setS] = React.useState<CopilotSignals>(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const setPattern = (e: CopilotEvent, patch: Partial<CopilotSignals["patterns"][CopilotEvent]>) =>
    setS((p) => ({ ...p, patterns: { ...p.patterns, [e]: { ...p.patterns[e], ...patch } } }));

  const save = async () => {
    setBusy("save");
    const r = await saveCopilotSignalsAction(s);
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "Failed");
    else toast.success("Semnalele Copilot salvate");
  };
  const test = async (e: CopilotEvent) => {
    if (dirty) {
      toast.error("Salvează mai întâi — testul folosește setările salvate");
      return;
    }
    setBusy(e);
    const r = await testCopilotSignalAction(e);
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "Failed");
    else toast.success(`Trimis: ${EVENT_META[e].label}`);
  };

  return (
    <section className="space-y-5" aria-labelledby="copilot-h">
      <header className="glass rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Bot className="size-5 text-primary" aria-hidden />
          <div>
            <h3 id="copilot-h" className="font-semibold">Semnale Copilot</h3>
            <p className="text-xs text-muted">Becuri, ecranul Turzx și ESP32 reacționează la ce face agentul în VS Code</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={s.enabled} onCheckedChange={(on) => setS((p) => ({ ...p, enabled: on }))} aria-label="Semnale active" />
            Activ
          </label>
          <Button size="sm" onClick={save} disabled={!dirty || busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</Button>
        </div>
      </header>

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-3">
        <p className="text-xs text-muted flex items-center gap-2"><Lightbulb className="size-3.5" aria-hidden /> Becurile care poartă semnalul</p>
        {lights.length === 0 && <p className="text-sm text-muted">Niciun bec RGB în Home Assistant încă. Împerechează becurile Calex în Smart Life; apar aici automat.</p>}
        <ul className="flex flex-wrap gap-2">
          {lights.map((l) => {
            const on = s.lights.includes(l.id);
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setS((p) => ({ ...p, lights: on ? p.lights.filter((x) => x !== l.id) : [...p.lights, l.id] }))}
                  aria-pressed={on}
                  className={cn("rounded-full border px-3 py-1 text-sm transition", on ? "border-primary bg-primary/15 text-foreground" : "border-border text-muted hover:text-foreground")}
                >
                  {l.name}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-3 sm:grid-cols-3 pt-2">
          <label className="flex items-center justify-between gap-3 text-sm rounded-xl border border-border px-3 py-2">
            <span>Mut în timpul filmului</span>
            <Switch checked={s.muteInMovie} onCheckedChange={(on) => setS((p) => ({ ...p, muteInMovie: on }))} aria-label="Mut în movie mode" />
          </label>
          <label className="text-sm rounded-xl border border-border px-3 py-2 flex items-center justify-between gap-3">
            <span>Liniște de la</span>
            <Input type="time" value={s.quietFrom} onChange={(e) => setS((p) => ({ ...p, quietFrom: e.target.value }))} className="w-28 h-8" aria-label="Liniște de la" />
          </label>
          <label className="text-sm rounded-xl border border-border px-3 py-2 flex items-center justify-between gap-3">
            <span>până la</span>
            <Input type="time" value={s.quietTo} onChange={(e) => setS((p) => ({ ...p, quietTo: e.target.value }))} className="w-28 h-8" aria-label="Liniște până la" />
          </label>
        </div>
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-2">
        <p className="text-xs text-muted">Evenimente — ce se aprinde, unde, în ce culoare</p>
        <ul className="space-y-2">
          {COPILOT_EVENTS.map((e) => {
            const p = s.patterns[e];
            return (
              <li key={e} className={cn("rounded-xl border px-3 py-2 flex flex-wrap items-center gap-3", p.enabled ? "border-primary/40 bg-primary/5" : "border-border opacity-70")}>
                <Switch checked={p.enabled} onCheckedChange={(on) => setPattern(e, { enabled: on })} aria-label={`${EVENT_META[e].label} activ`} />
                <div className="flex-1 min-w-40">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{EVENT_META[e].label}</span>
                    <Badge variant="muted">{e}</Badge>
                  </div>
                  <p className="text-xs text-muted">{EVENT_META[e].hint}</p>
                </div>
                <input type="color" value={p.color} onChange={(ev) => setPattern(e, { color: ev.target.value })} aria-label={`Culoare ${EVENT_META[e].label}`} className="size-8 rounded-md border border-border bg-transparent p-0.5" />
                <div className="flex items-center gap-1" role="group" aria-label={`Ținte ${EVENT_META[e].label}`}>
                  <Target on={p.light} onChange={(v) => setPattern(e, { light: v })} label="Becuri"><Lightbulb className="size-3.5" aria-hidden /></Target>
                  <Target on={p.strip} onChange={(v) => setPattern(e, { strip: v })} label="Bandă monitor"><Sparkles className="size-3.5" aria-hidden /></Target>
                  <Target on={p.turzx} onChange={(v) => setPattern(e, { turzx: v })} label="Turzx"><MonitorSmartphone className="size-3.5" aria-hidden /></Target>
                  <Target on={p.esp} onChange={(v) => setPattern(e, { esp: v })} label="ESP32"><Radio className="size-3.5" aria-hidden /></Target>
                </div>
                <Button size="sm" variant="outline" onClick={() => test(e)} disabled={busy !== null || !p.enabled} aria-label={`Testează ${EVENT_META[e].label}`}>
                  <Play className="size-3.5" aria-hidden /> Test
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Target({ on, onChange, label, children }: { on: boolean; onChange: (v: boolean) => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      title={label}
      className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition", on ? "border-primary bg-primary/15" : "border-border text-muted")}
    >
      {children}
      <span className="sr-only sm:not-sr-only">{label}</span>
    </button>
  );
}
