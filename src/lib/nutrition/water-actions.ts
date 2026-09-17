import "server-only";

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { pushActivity } from "@/lib/esp/activity";
import { setNutritionEvent } from "./events";
import { nutritionSummary, publishToHa } from "./summary";
import { addWater, GLASS_ML, undoWater, type WaterSummary } from "./water";

export interface WaterResult {
  ok: true;
  action: "add" | "undo" | "noop";
  ml: number;
  water: WaterSummary;
}

const fmt = (ml: number) => (ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 ? 2 : 1).replace(/\.?0+$/, "")} L` : `${ml} ml`);

/** One glass in: log, screen card, HA mirror, audit. Shared by the desk
 *  button, the phone route and the /home card so all three behave the same. */
export async function drinkGlass(ml = GLASS_ML, source = "web"): Promise<WaterResult> {
  await addWater(ml, source);
  const s = await nutritionSummary();
  const w = s.water;
  setNutritionEvent({ kind: "meal", at: Date.now(), name: `+${fmt(ml)} apă`, text: `${fmt(w.ml)} din ${fmt(w.targetMl)}${w.remainingMl === 0 ? " · țintă atinsă" : ""}` });
  pushActivity({ at: Date.now(), kind: "other", text: `apă +${ml} ml (${w.glasses} pahare, ${fmt(w.ml)})` });
  await db.insert(auditLog).values({ accountId: "home", action: "nutrition.water.add", target: source, status: "ok", message: `${ml} ml -> ${w.ml}/${w.targetMl}` });
  publishToHa(s).catch(() => undefined);
  return { ok: true, action: "add", ml, water: w };
}

export async function undoGlass(source = "web"): Promise<WaterResult> {
  const removed = await undoWater();
  const s = await nutritionSummary();
  const w = s.water;
  if (removed) {
    setNutritionEvent({ kind: "meal", at: Date.now(), name: "Pahar anulat", text: `${fmt(w.ml)} din ${fmt(w.targetMl)}` });
    await db.insert(auditLog).values({ accountId: "home", action: "nutrition.water.undo", target: source, status: "ok", message: `-${removed.ml} ml -> ${w.ml}/${w.targetMl}` });
    publishToHa(s).catch(() => undefined);
  }
  return { ok: true, action: removed ? "undo" : "noop", ml: removed?.ml ?? 0, water: w };
}
