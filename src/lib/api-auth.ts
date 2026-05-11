import "server-only";

import { eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, type ApiKeyRow } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";

export type ApiAuthResult =
  | { ok: true; keyId: string; role: ApiKeyRow["role"]; rateLimitPerMinute: number }
  | { ok: false; status: 401 | 403 | 429; error: string };

type RateBucket = { count: number; windowStart: number };

const RATE_MAP_KEY = "__vmuiApiRateMap__" as const;
type GlobalWithRate = typeof globalThis & { [RATE_MAP_KEY]?: Map<string, RateBucket> };

function rateMap(): Map<string, RateBucket> {
  const g = globalThis as GlobalWithRate;
  if (!g[RATE_MAP_KEY]) g[RATE_MAP_KEY] = new Map();
  return g[RATE_MAP_KEY]!;
}

function consume(keyId: string, limit: number): boolean {
  const now = Date.now();
  const map = rateMap();
  const bucket = map.get(keyId);
  if (!bucket || now - bucket.windowStart >= 60_000) {
    map.set(keyId, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Issue a fresh plaintext key. Returns the key (shown once) and the storable hash. */
export async function generateApiKey(): Promise<{ plaintext: string; hash: string }> {
  const random = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const plaintext = `vmui_${random}`;
  const hash = await hashPassword(plaintext);
  return { plaintext, hash };
}

export async function validateApiKey(req: Request): Promise<ApiAuthResult> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return { ok: false, status: 401, error: "Missing bearer token" };
  const token = m[1]!.trim();
  if (!token) return { ok: false, status: 401, error: "Empty bearer token" };

  const rows = await db.select().from(apiKeys).where(isNull(apiKeys.revokedAt));
  for (const row of rows) {
    if (await verifyPassword(token, row.hash)) {
      if (!consume(row.id, row.rateLimitPerMinute)) {
        return { ok: false, status: 429, error: "Rate limit exceeded" };
      }
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
      return { ok: true, keyId: row.id, role: row.role, rateLimitPerMinute: row.rateLimitPerMinute };
    }
  }
  return { ok: false, status: 401, error: "Invalid token" };
}

export function requireApiRole(
  result: ApiAuthResult,
  min: "viewer" | "operator",
): ApiAuthResult {
  if (!result.ok) return result;
  if (min === "operator" && result.role !== "operator") {
    return { ok: false, status: 403, error: "Operator role required" };
  }
  return result;
}
