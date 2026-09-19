import "server-only";

import { db } from "@/lib/db";
import { turzxSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { BUTTON_DEFAULTS, buttonBindingsSchema, type ButtonBindings } from "./button-bindings-schema";

export * from "./button-bindings-schema";

/** Physical desk button (Pi GPIO, or the ESP32 case switch) → what each
 *  gesture does. Stored as one JSON row (id=3) next to the Turzx settings so
 *  it needs no migration; the UI on /home?tab=devices edits it. */
const ROW_ID = 7; // was 3, shared with copilot signals (each save clobbered the other)

export async function loadButtonBindings(): Promise<ButtonBindings> {
  const row = await db.select().from(turzxSettings).where(eq(turzxSettings.id, ROW_ID)).get();
  if (!row) return BUTTON_DEFAULTS;
  const parsed = buttonBindingsSchema.safeParse(JSON.parse(row.json));
  return parsed.success ? parsed.data : BUTTON_DEFAULTS;
}

export async function saveButtonBindings(b: ButtonBindings): Promise<void> {
  const json = JSON.stringify(buttonBindingsSchema.parse(b));
  await db.insert(turzxSettings).values({ id: ROW_ID, json }).onConflictDoUpdate({ target: turzxSettings.id, set: { json, updatedAt: new Date() } });
}
