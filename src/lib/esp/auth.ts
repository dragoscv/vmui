import { db } from "@/lib/db";
import { pairedDevices } from "@/lib/db/schema";
import { credential } from "@/lib/home/credentials";
import { eq } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";
import "server-only";

// Two ways in for the non-browser clients:
//   ?k= / x-esp-token  — the shared ESP_DISPLAY_TOKEN from .private/credentials.env
//                        (ESP32, Nest Hub kiosk, hub-cast, HA rest_command).
//   Authorization: Bearer vmd_… / ?d=  — a per-device token issued by the
//                        pairing flow (lib/devices/pairing.ts) for the phone and
//                        desktop apps; revocable per device.
// better-sqlite3 is synchronous, so the device lookup keeps this function sync.
export function espAuthorized(req: Request): boolean {
  const url = new URL(req.url);
  const want = credential("ESP_DISPLAY_TOKEN");
  const k = url.searchParams.get("k") ?? req.headers.get("x-esp-token") ?? "";
  if (want && k) {
    const a = Buffer.from(k);
    const b = Buffer.from(want);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  const d = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("d") ?? "";
  if (!d.startsWith("vmd_")) return false;
  const hash = createHash("sha256").update(d).digest("hex");
  const row = db.select({ id: pairedDevices.id, status: pairedDevices.status }).from(pairedDevices).where(eq(pairedDevices.tokenHash, hash)).get();
  if (!row || row.status !== "approved") return false;
  touch(row.id, req);
  return true;
}

const seen = new Map<string, number>();
function touch(id: string, req: Request) {
  const now = Date.now();
  if (now - (seen.get(id) ?? 0) < 60_000) return;
  seen.set(id, now);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  db.update(pairedDevices).set({ lastSeenAt: new Date(), lastIp: ip }).where(eq(pairedDevices.id, id)).run();
}
