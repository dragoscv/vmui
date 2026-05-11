import { describe, it, expect } from "vitest";
import { redactSecrets } from "./redact";

describe("redactSecrets", () => {
  it("masks AWS access key ids", () => {
    expect(redactSecrets("oops AKIAIOSFODNN7EXAMPLE failed")).toMatch(/AKIAXXXXXXXXXXXXXXXX/);
    expect(redactSecrets("ASIAQWERTYUIOPASDFGH")).toMatch(/ASIAXXXXXXXXXXXXXXXX/);
  });

  it("redacts bearer tokens", () => {
    const out = redactSecrets("Authorization: Bearer abc123.def456-ghi");
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("abc123");
  });

  it("redacts JSON-shaped secrets", () => {
    const out = redactSecrets('{"clientSecret":"super-secret-value","other":"keep"}');
    expect(out).toContain("[redacted]");
    expect(out).toContain("keep");
    expect(out).not.toContain("super-secret-value");
  });

  it("redacts query-string secrets", () => {
    const out = redactSecrets("url?password=hunter2&user=bob");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("user=bob");
  });

  it("redacts PEM private keys but preserves headers", () => {
    const pem = `prefix -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY----- suffix`;
    const out = redactSecrets(pem);
    expect(out).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(out).toContain("-----END RSA PRIVATE KEY-----");
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("MIIEowIBAAKCAQEA");
  });

  it("accepts Error and unknown inputs", () => {
    expect(redactSecrets(new Error("token=abc"))).toContain("[redacted]");
    expect(redactSecrets({ a: 1 })).toBe('{"a":1}');
  });

  it("passes through innocuous strings unchanged", () => {
    expect(redactSecrets("just a normal log line")).toBe("just a normal log line");
  });
});
