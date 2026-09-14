import { db } from "@/lib/db";
import { turzxSettings } from "@/lib/db/schema";
import "server-only";
import { z } from "zod";

// The Turzx 3.5" USB screen on the desk. The Python renderer (turzx/turzx.py)
// pulls this every few seconds, so a change in /home lands on the screen
// without a restart.

export const TURZX_VIEWS = ["clock", "weather", "home", "ambilight", "pc", "activity", "media", "lists"] as const;
export type TurzxView = (typeof TURZX_VIEWS)[number];

export const turzxSettingsSchema = z.object({
  views: z.array(z.enum(TURZX_VIEWS)).min(1),
  dwellSec: z.number().min(3).max(120),
  fps: z.number().min(5).max(30),
  transitionMs: z.number().min(0).max(2000),
  brightness: z.number().min(5).max(100),
  nightBrightness: z.number().min(0).max(100),
  nightFrom: z.string().regex(/^\d{2}:\d{2}$/),
  nightTo: z.string().regex(/^\d{2}:\d{2}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Rotate 180° for a screen whose cable exits on the other side. */
  flip: z.boolean().default(false),
});
export type TurzxSettings = z.infer<typeof turzxSettingsSchema>;

export const TURZX_DEFAULTS: TurzxSettings = {
  views: [...TURZX_VIEWS],
  dwellSec: 12,
  fps: 20,
  transitionMs: 600,
  brightness: 60,
  nightBrightness: 15,
  nightFrom: "23:00",
  nightTo: "07:30",
  accent: "#7c9cff",
  flip: false,
};

export async function loadTurzxSettings(): Promise<TurzxSettings> {
  const row = await db.select().from(turzxSettings).get();
  if (!row) return TURZX_DEFAULTS;
  const parsed = turzxSettingsSchema.safeParse(JSON.parse(row.json));
  return parsed.success ? parsed.data : TURZX_DEFAULTS;
}

export async function saveTurzxSettings(s: TurzxSettings): Promise<void> {
  const json = JSON.stringify(s);
  await db.insert(turzxSettings).values({ id: 1, json }).onConflictDoUpdate({ target: turzxSettings.id, set: { json, updatedAt: new Date() } });
}
