import "server-only";

import { authenticator } from "otplib";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import { encryptJSON, decryptJSON, encrypt, decrypt } from "@/lib/crypto";

authenticator.options = { window: 1, step: 30, digits: 6 };

/** Cryptographically random base32 secret suitable for TOTP. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(secret: string, email: string): string {
  return authenticator.keyuri(email, "vmui", secret);
}

export async function totpQrDataUrl(secret: string, email: string): Promise<string> {
  return QRCode.toDataURL(totpUri(secret, email), {
    margin: 1,
    width: 240,
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    return authenticator.verify({ token: cleaned, secret });
  } catch {
    return false;
  }
}

export function encryptTotpSecret(secret: string): string {
  return encrypt(secret);
}

export function decryptTotpSecret(enc: string): string {
  return decrypt(enc);
}

/** Generate N single-use backup codes, returned plaintext. */
export function generateBackupCodes(count = 10): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(5).toString("hex"); // 10 hex chars
    out.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return out;
}

/** SHA-256 a backup code so we never store plaintext at rest. */
function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

export function encryptBackupCodes(codes: string[]): string {
  return encryptJSON(codes.map(hashBackupCode));
}

/**
 * Check `code` against stored hashes; on success returns the new (codes
 * remaining) ciphertext to persist. Constant-time compare per entry.
 */
export function consumeBackupCode(
  enc: string | null | undefined,
  code: string,
): { ok: true; newEnc: string } | { ok: false } {
  if (!enc) return { ok: false };
  let hashes: string[];
  try {
    hashes = decryptJSON<string[]>(enc);
  } catch {
    return { ok: false };
  }
  const target = hashBackupCode(code);
  const targetBuf = Buffer.from(target, "hex");
  let matchIdx = -1;
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i];
    if (!h || h.length !== target.length) continue;
    const hBuf = Buffer.from(h, "hex");
    if (hBuf.length === targetBuf.length && timingSafeEqual(hBuf, targetBuf)) {
      matchIdx = i;
      break;
    }
  }
  if (matchIdx === -1) return { ok: false };
  const remaining = hashes.filter((_, i) => i !== matchIdx);
  return { ok: true, newEnc: encryptJSON(remaining) };
}

export function countBackupCodes(enc: string | null | undefined): number {
  if (!enc) return 0;
  try {
    return decryptJSON<string[]>(enc).length;
  } catch {
    return 0;
  }
}
