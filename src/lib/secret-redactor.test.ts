import { describe, expect, it } from "vitest";
import { redact, redactQuiet } from "./secret-redactor";

describe("secret-redactor", () => {
  it("redacts AWS access key id", () => {
    const r = redact("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(r.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.text).toContain("aws-key");
    expect(r.hits.find((h) => h.pattern === "aws_access_key_id")?.count).toBe(1);
  });

  it("redacts GitHub PATs", () => {
    const out = redactQuiet("token=ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(out).not.toContain("ghp_abcdef");
    expect(out).toContain("gh-token");
  });

  it("redacts JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = redactQuiet(`Authorization: ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).toContain("jwt");
  });

  it("redacts PEM private key block", () => {
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nabcdefgh\n-----END OPENSSH PRIVATE KEY-----";
    const out = redactQuiet(`key:\n${pem}`);
    expect(out).not.toContain("abcdefgh");
    expect(out).toContain("pem-private-key");
  });

  it("redacts Bearer headers", () => {
    const out = redactQuiet("Authorization: Bearer abc123def456ghi789jkl012");
    expect(out).not.toContain("abc123def456");
  });

  it("redacts password assignments", () => {
    const out = redactQuiet('config: {"password": "hunter2hunter2"}');
    expect(out).not.toContain("hunter2hunter2");
  });

  it("redacts Romanian IBAN", () => {
    const out = redactQuiet("Paid to RO49AAAA1B31007593840000");
    expect(out).not.toContain("RO49AAAA1B31007593840000");
    expect(out).toContain("iban");
  });

  it("preserves non-secret text", () => {
    const out = redactQuiet("hello world 42 normal log line");
    expect(out).toBe("hello world 42 normal log line");
  });

  it("aggregates multiple hits", () => {
    const r = redact("AKIAIOSFODNN7EXAMPLE and ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1234");
    expect(r.hits.length).toBeGreaterThanOrEqual(2);
  });
});
