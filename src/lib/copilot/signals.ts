import "server-only";

import { db } from "@/lib/db";
import { turzxSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { COPILOT_SIGNALS_DEFAULTS, copilotSignalsSchema, type CopilotEvent, type CopilotSignals } from "./signals-schema";

export * from "./signals-schema";

// Same key/value table as turzx settings; row id=3.
const ROW_ID = 3;

export async function loadCopilotSignals(): Promise<CopilotSignals> {
  const row = await db.select().from(turzxSettings).where(eq(turzxSettings.id, ROW_ID)).get();
  if (!row) return COPILOT_SIGNALS_DEFAULTS;
  const p = copilotSignalsSchema.safeParse(JSON.parse(row.json));
  return p.success ? p.data : COPILOT_SIGNALS_DEFAULTS;
}

export async function saveCopilotSignals(s: CopilotSignals): Promise<void> {
  const json = JSON.stringify(s);
  await db.insert(turzxSettings).values({ id: ROW_ID, json }).onConflictDoUpdate({ target: turzxSettings.id, set: { json, updatedAt: new Date() } });
}

/** Latest event for the screens. `id` changes per event so turzx pops it once;
 *  `active` stays true for `ask` until cancelled, so turzx can keep a badge. */
export type CopilotSignalState = {
  id: string;
  at: number;
  event: CopilotEvent;
  text: string;
  source: string;
  session: string;
  active: boolean;
};

type Store = { current: CopilotSignalState | null };
const store: Store = ((globalThis as unknown as { __vmuiCopilotSignal?: Store }).__vmuiCopilotSignal ??= { current: null });

/** No alert outlives this: a missed cancel must not leave a card or a bulb on. */
export const ASK_TTL_MS = 10_000;

export function currentSignal(): CopilotSignalState | null {
  const s = store.current;
  if (s?.active && Date.now() - s.at > ASK_TTL_MS) store.current = { ...s, active: false };
  return store.current;
}

export function setSignal(s: CopilotSignalState | null): void {
  store.current = s;
}

export function inQuietHours(s: CopilotSignals, now = new Date()): boolean {
  const [fh, fm] = s.quietFrom.split(":").map(Number);
  const [th, tm] = s.quietTo.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = (fh ?? 0) * 60 + (fm ?? 0);
  const to = (th ?? 0) * 60 + (tm ?? 0);
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to;
}
