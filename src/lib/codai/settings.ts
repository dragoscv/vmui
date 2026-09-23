import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { decryptJSON, encryptJSON } from "@/lib/crypto";
import { DEFAULT_CODAI_GATEWAY_URL, describeApiKey } from "./install-command";

const GATEWAY_KEY = "codai_gateway_url";
/** AES-256-GCM envelope of `{ apiKey: string }` — same shape as `cloud_accounts.credentials_enc`. */
const API_KEY_ENC_KEY = "codai_api_key_enc";

export interface CodaiSettingsPublic {
  gatewayUrl: string;
  configured: boolean;
  apiKeyPrefix: string | null;
  apiKeyLength: number | null;
}

export interface CodaiSettingsSecret {
  gatewayUrl: string;
  apiKey: string;
}

async function getValue(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return row?.value ?? null;
}

async function setValue(key: string, value: string): Promise<void> {
  const [existing] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (existing) await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key));
  else await db.insert(settings).values({ key, value });
}

export async function getCodaiSettingsPublic(): Promise<CodaiSettingsPublic> {
  const [gw, enc] = await Promise.all([getValue(GATEWAY_KEY), getValue(API_KEY_ENC_KEY)]);
  let desc: { prefix: string; length: number } | null = null;
  if (enc) {
    try {
      desc = describeApiKey(decryptJSON<{ apiKey: string }>(enc).apiKey);
    } catch {
      desc = null;
    }
  }
  return {
    gatewayUrl: gw ?? DEFAULT_CODAI_GATEWAY_URL,
    configured: desc !== null,
    apiKeyPrefix: desc?.prefix ?? null,
    apiKeyLength: desc?.length ?? null,
  };
}

/** Decrypted credentials for server-side use only. Never return this to a client component. */
export async function getCodaiSettingsSecret(): Promise<CodaiSettingsSecret> {
  const [gw, enc] = await Promise.all([getValue(GATEWAY_KEY), getValue(API_KEY_ENC_KEY)]);
  if (!enc) throw new Error("codai is not configured — add an API key under Settings → Integrations");
  const { apiKey } = decryptJSON<{ apiKey: string }>(enc);
  return { gatewayUrl: gw ?? DEFAULT_CODAI_GATEWAY_URL, apiKey };
}

export async function saveCodaiSettings(input: { gatewayUrl: string; apiKey?: string | null }): Promise<void> {
  await setValue(GATEWAY_KEY, input.gatewayUrl.replace(/\/+$/, ""));
  if (input.apiKey) await setValue(API_KEY_ENC_KEY, encryptJSON({ apiKey: input.apiKey }));
}

export async function clearCodaiApiKey(): Promise<void> {
  await db.delete(settings).where(eq(settings.key, API_KEY_ENC_KEY));
}
