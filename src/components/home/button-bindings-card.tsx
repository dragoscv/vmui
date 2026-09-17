"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GESTURE_LABEL, GESTURES, type ButtonAction, type ButtonBindings, type Gesture } from "@/lib/home/button-bindings-schema";
import { saveButtonBindingsAction, testButtonGestureAction } from "@/server/actions/button-bindings";
import { CirclePlay, MousePointerClick, Save } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

type Kind = ButtonAction["type"];
const KIND_LABEL: Record<Kind, string> = {
  none: "Nimic",
  water_add: "Apă: adaugă ml",
  water_undo: "Apă: anulează ultima",
  ha_script: "Home Assistant: script",
  ha_service: "Home Assistant: serviciu",
  intercom_open: "Interfon: deschide",
  intercom_arm: "Interfon: auto-deschidere (min)",
  turzx_next: "Turzx: view următor",
  turzx_pause: "Turzx: pauză / continuă",
  ambilight_movie: "Ambilight: movie mode",
};

function defaultFor(kind: Kind): ButtonAction {
  switch (kind) {
    case "water_add": return { type: kind, ml: 250 };
    case "ha_script": return { type: kind, script: "" };
    case "ha_service": return { type: kind, service: "light.toggle", entityId: "" };
    case "intercom_arm": return { type: kind, minutes: 45 };
    default: return { type: kind } as ButtonAction;
  }
}

/** Gesture → action table for the desk button (Pi GPIO). Same store drives
 *  `POST /api/esp/button?btn=desk`, so what you save here is what the button does. */
export function ButtonBindingsCard({ initial, scripts }: { initial: ButtonBindings; scripts: string[] }) {
  const [b, setB] = React.useState<ButtonBindings>(initial);
  const [busy, setBusy] = React.useState<string | null>(null);
  const dirty = JSON.stringify(b) !== JSON.stringify(initial);

  const set = (g: Gesture, a: ButtonAction) => setB((s) => ({ ...s, gestures: { ...s.gestures, [g]: a } }));

  const save = async () => {
    setBusy("save");
    const clean: ButtonBindings = { ...b, gestures: { ...b.gestures } };
    for (const g of GESTURES) {
      const a = clean.gestures[g] ?? { type: "none" };
      if (a.type === "ha_service" && !a.entityId) clean.gestures[g] = { type: "ha_service", service: a.service };
    }
    const r = await saveButtonBindingsAction(clean);
    setBusy(null);
    if (r.ok) toast.success("Butonul a fost reconfigurat");
    else toast.error(r.error);
  };
  const test = async (g: Gesture) => {
    setBusy(g);
    const r = await testButtonGestureAction(g);
    setBusy(null);
    if (r.ok) toast.success(r.message ?? "ok");
    else toast.error(r.error);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MousePointerClick className="size-4 text-muted" aria-hidden />
            Butonul de birou
          </CardTitle>
          <CardDescription>Ce face fiecare gest. Implicit: 1 click = un pahar de apă. Fereastra între clickuri e 400 ms; apăsarea lungă ≥ 1 s.</CardDescription>
        </div>
        <Button onClick={save} disabled={!dirty || busy !== null}>
          <Save className="size-4" aria-hidden /> Salvează
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-[var(--color-border)]">
          {GESTURES.map((g) => {
            const a: ButtonAction = b.gestures[g] ?? { type: "none" };
            return (
              <li key={g} className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[9rem_1fr_auto]">
                <Label className="font-semibold">{GESTURE_LABEL[g]}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={a.type} onValueChange={(v) => set(g, defaultFor(v as Kind))}>
                    <SelectTrigger className="w-64" aria-label={`Acțiune pentru ${GESTURE_LABEL[g]}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                        <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {a.type === "water_add" && (
                    <Input type="number" min={10} max={2000} step={10} className="w-24" value={a.ml} aria-label="mililitri" onChange={(e) => set(g, { type: "water_add", ml: Number(e.target.value) || 0 })} />
                  )}
                  {a.type === "intercom_arm" && (
                    <Input type="number" min={1} max={240} className="w-24" value={a.minutes} aria-label="minute" onChange={(e) => set(g, { type: "intercom_arm", minutes: Number(e.target.value) || 1 })} />
                  )}
                  {a.type === "ha_script" && (
                    <Select value={a.script} onValueChange={(v) => set(g, { type: "ha_script", script: v })}>
                      <SelectTrigger className="w-56" aria-label="Script"><SelectValue placeholder="alege scriptul" /></SelectTrigger>
                      <SelectContent>
                        {scripts.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {a.type === "ha_service" && (
                    <>
                      <Input className="w-40" placeholder="light.toggle" value={a.service} aria-label="serviciu" onChange={(e) => set(g, { ...a, service: e.target.value })} />
                      <Input className="w-56" placeholder="light.birou (opțional)" value={a.entityId ?? ""} aria-label="entitate" onChange={(e) => set(g, { ...a, entityId: e.target.value })} />
                    </>
                  )}
                </div>
                <Button variant="ghost" size="sm" disabled={busy !== null || a.type === "none"} onClick={() => test(g)} aria-label={`Testează ${GESTURE_LABEL[g]}`}>
                  <CirclePlay className="size-4" aria-hidden /> Test
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
