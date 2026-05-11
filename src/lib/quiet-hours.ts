import "server-only";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const KEY = "quiet_hours";

export interface QuietHoursConfig {
  enabled: boolean;
  /** "HH:MM" 24h, server local time. */
  startHHMM: string;
  endHHMM: string;
  /** Severities that are still allowed during quiet hours. */
  allowSeverities: ("error" | "warning" | "success" | "info")[];
}

const DEFAULT: QuietHoursConfig = {
  enabled: false,
  startHHMM: "22:00",
  endHHMM: "07:00",
  allowSeverities: ["error"],
};

export async function getQuietHours(): Promise<QuietHoursConfig> {
  const row = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  if (!row[0]) return DEFAULT;
  try {
    return { ...DEFAULT, ...(JSON.parse(row[0].value) as Partial<QuietHoursConfig>) };
  } catch { return DEFAULT; }
}

export async function setQuietHours(cfg: QuietHoursConfig): Promise<void> {
  const value = JSON.stringify(cfg);
  const existing = await db.select().from(settings).where(eq(settings.key, KEY)).limit(1);
  if (existing[0]) {
    await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, KEY));
  } else {
    await db.insert(settings).values({ key: KEY, value });
  }
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map((p) => Number(p));
  return ((h ?? 0) * 60) + (m ?? 0);
}

export function isQuietNow(cfg: QuietHoursConfig, now = new Date()): boolean {
  if (!cfg.enabled) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = parseHHMM(cfg.startHHMM);
  const end = parseHHMM(cfg.endHHMM);
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}
