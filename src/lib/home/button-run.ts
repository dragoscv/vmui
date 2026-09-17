import "server-only";

import { pushActivity } from "@/lib/esp/activity";
import { listNodes, nextView, showMessage, togglePause } from "@/lib/esp/gallery";
import { ambilightStatus } from "@/lib/home/ambilight-status";
import { ha } from "@/lib/home/ha-client";
import { armAutoOpen, openDoor } from "@/lib/home/intercom";
import { wakePc } from "@/lib/home/wol";
import { drinkGlass, undoGlass } from "@/lib/nutrition/water-actions";
import { type ButtonAction, type Gesture, loadButtonBindings } from "./button-bindings";

export interface ButtonRunResult {
  action: ButtonAction;
  result: string;
  /** Blink count for a status LED: 1 ok, 2 undo/off, 3 nothing to do, 5 error. */
  led: 1 | 2 | 3 | 5;
}

export async function runButtonGesture(gesture: Gesture, source: string): Promise<ButtonRunResult> {
  const b = await loadButtonBindings();
  const action = b.gestures[gesture] ?? { type: "none" };
  return runButtonAction(action, source);
}

export async function runButtonAction(action: ButtonAction, source: string): Promise<ButtonRunResult> {
  const say = (title: string, body: string) => {
    for (const n of listNodes()) showMessage(n.name, title, body, 3);
  };
  switch (action.type) {
    case "none":
      return { action, result: "noop", led: 3 };
    case "water_add": {
      const r = await drinkGlass(action.ml, source);
      return { action, result: `add ${r.ml} ml -> ${r.water.ml}/${r.water.targetMl}`, led: 1 };
    }
    case "water_undo": {
      const r = await undoGlass(source);
      return { action, result: `${r.action} ${r.ml} ml -> ${r.water.ml}/${r.water.targetMl}`, led: r.action === "undo" ? 2 : 3 };
    }
    case "ha_script":
      await ha.runScript(action.script);
      pushActivity({ at: Date.now(), kind: "scene", text: `buton: script ${action.script}` });
      return { action, result: `script ${action.script}`, led: 1 };
    case "ha_service": {
      const [domain, service] = action.service.split(".") as [string, string];
      await ha.callService(domain, service, action.entityId ? { entity_id: action.entityId } : {});
      pushActivity({ at: Date.now(), kind: "scene", text: `buton: ${action.service} ${action.entityId ?? ""}`.trim() });
      return { action, result: action.service, led: 1 };
    }
    case "intercom_open": {
      const r = await openDoor(source);
      return { action, result: r.ok ? "intercom opened" : `intercom: ${r.error ?? "refused"}`, led: r.ok ? 1 : 3 };
    }
    case "intercom_arm": {
      await armAutoOpen(action.minutes, source);
      say("Interfon", `Auto-deschidere ${action.minutes} min`);
      return { action, result: `intercom armed ${action.minutes} min`, led: 1 };
    }
    case "turzx_next": {
      const views = listNodes().map((n) => `${n.name}:${nextView(n.name)}`);
      return { action, result: `view ${views.join(",")}`, led: 1 };
    }
    case "turzx_pause": {
      const paused = listNodes().map((n) => togglePause(n.name));
      return { action, result: paused[0] ? "paused" : "resumed", led: paused[0] ? 2 : 1 };
    }
    case "pc_wake": {
      const r = await wakePc(source);
      if (!r.ok) return { action, result: r.error, led: 5 };
      say("PC", r.alreadyUp ? "Deja pornit" : "Wake-on-LAN trimis");
      return { action, result: r.alreadyUp ? "pc already up" : "wol sent", led: r.alreadyUp ? 3 : 1 };
    }
    case "ambilight_movie": {
      const h = await ha.state("light.hyperhdr").catch(() => null);
      const on = ambilightStatus(h) !== "movie";
      await ha.runScript(on ? "movie_mode_on" : "movie_mode_off");
      say("Ambilight", on ? "Movie mode pornit" : "Ambilight oprit");
      pushActivity({ at: Date.now(), kind: "scene", text: `buton: movie ${on ? "on" : "off"}` });
      return { action, result: on ? "movie on" : "movie off", led: on ? 1 : 2 };
    }
  }
}
