import { describe, it, expect, beforeAll } from "vitest";

// Force-set env BEFORE importing the module so its env validation runs with a key.
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
beforeAll(() => {
  process.env.VMUI_MASTER_KEY = TEST_KEY;
});

describe("crypto", () => {
  it("round-trips utf-8 strings", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const cipher = encrypt("hello vmui · €€€");
    expect(cipher).not.toContain("hello");
    expect(decrypt(cipher)).toBe("hello vmui · €€€");
  });

  it("round-trips JSON values", async () => {
    const { encryptJSON, decryptJSON } = await import("./crypto");
    const payload = { a: 1, b: ["two", null], c: { nested: true } };
    expect(decryptJSON(encryptJSON(payload))).toEqual(payload);
  });

  it("rejects tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const cipher = encrypt("safe");
    // Flip one byte in the ciphertext portion.
    const tampered = cipher.slice(0, -4) + "AAAA";
    expect(() => decrypt(tampered)).toThrow();
  });

  it("produces unique ciphertext per call (random IV)", async () => {
    const { encrypt } = await import("./crypto");
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });
});
