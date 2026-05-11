import { describe, it, expect, beforeAll } from "vitest";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
beforeAll(() => {
  process.env.VMUI_MASTER_KEY = TEST_KEY;
});

describe("totp", () => {
  it("generates a valid base32 secret of reasonable length", async () => {
    const { generateTotpSecret } = await import("./totp");
    const s = generateTotpSecret();
    expect(s.length).toBeGreaterThanOrEqual(16);
    expect(/^[A-Z2-7]+$/.test(s)).toBe(true);
  });

  it("round-trips secret encryption", async () => {
    const { generateTotpSecret, encryptTotpSecret, decryptTotpSecret } = await import("./totp");
    const s = generateTotpSecret();
    const enc = encryptTotpSecret(s);
    expect(enc).not.toContain(s);
    expect(decryptTotpSecret(enc)).toBe(s);
  });

  it("verifies a code produced by otplib for the same secret", async () => {
    const { generateTotpSecret, verifyTotpCode } = await import("./totp");
    const { authenticator } = await import("otplib");
    const s = generateTotpSecret();
    const code = authenticator.generate(s);
    expect(verifyTotpCode(s, code)).toBe(true);
    expect(verifyTotpCode(s, "000000")).toBe(false);
    expect(verifyTotpCode(s, "abcdef")).toBe(false);
  });

  it("generates and consumes backup codes (single-use, hashed at rest)", async () => {
    const { generateBackupCodes, encryptBackupCodes, consumeBackupCode, countBackupCodes } =
      await import("./totp");
    const codes = generateBackupCodes(5);
    expect(codes).toHaveLength(5);
    expect(new Set(codes).size).toBe(5);
    const enc = encryptBackupCodes(codes);
    // Plaintext code never present in ciphertext
    for (const c of codes) expect(enc).not.toContain(c);
    expect(countBackupCodes(enc)).toBe(5);

    // First consume succeeds and returns reduced state.
    const r1 = consumeBackupCode(enc, codes[0]!);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(countBackupCodes(r1.newEnc)).toBe(4);

    // Same code cannot be reused.
    const r2 = consumeBackupCode(r1.newEnc, codes[0]!);
    expect(r2.ok).toBe(false);

    // A bogus code is rejected.
    const r3 = consumeBackupCode(r1.newEnc, "00000-00000");
    expect(r3.ok).toBe(false);
  });

  it("countBackupCodes returns 0 for null / malformed input", async () => {
    const { countBackupCodes, consumeBackupCode } = await import("./totp");
    expect(countBackupCodes(null)).toBe(0);
    expect(countBackupCodes(undefined)).toBe(0);
    expect(consumeBackupCode(null, "anything").ok).toBe(false);
  });
});
