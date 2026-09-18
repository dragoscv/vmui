import { db } from "@/lib/db";
import { turzxSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import "server-only";
import { DISPLAY_DEFAULTS, DISPLAY_VIEW_IDS, DISPLAY_VIEW_META, displaySettingsSchema, type DisplaySettings } from "./settings-meta";

export * from "./settings-meta";

const ROW_ID = 4;

export async function loadDisplaySettings(): Promise<DisplaySettings> {
  const row = await db.select().from(turzxSettings).where(eq(turzxSettings.id, ROW_ID)).get();
  if (!row) return DISPLAY_DEFAULTS;
  const p = displaySettingsSchema.safeParse(JSON.parse(row.json));
  if (!p.success) return DISPLAY_DEFAULTS;
  const have = new Set(p.data.views.map((v) => v.id));
  const missing = DISPLAY_VIEW_IDS.filter((id) => !have.has(id)).map((id) => ({ id, enabled: false, dwellSec: DISPLAY_VIEW_META[id].defaultDwell, photo: true }));
  return missing.length ? { ...p.data, views: [...p.data.views, ...missing] } : p.data;
}

export async function saveDisplaySettings(s: DisplaySettings): Promise<void> {
  const json = JSON.stringify(s);
  await db.insert(turzxSettings).values({ id: ROW_ID, json }).onConflictDoUpdate({ target: turzxSettings.id, set: { json, updatedAt: new Date() } });
}
