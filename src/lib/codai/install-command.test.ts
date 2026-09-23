import { describe, expect, it } from "vitest";
import { buildInstallCommand, describeApiKey, hubProjectUrl, redactInstallCommand } from "./install-command";

const TOKEN = "codai_env_AbCdEfGhIjKlMnOpQrStUvWxYz012345";

describe("buildInstallCommand", () => {
  it("matches the install.sh contract exactly", () => {
    expect(buildInstallCommand({ enrollToken: TOKEN })).toBe(
      `curl -fsSL https://codai.ro/install-codaid.sh | CODAI_ENROLL_TOKEN=${TOKEN} CODAI_GATEWAY_URL=https://ai.codai.ro sh`,
    );
  });

  it("uses a custom gateway and strips trailing slashes", () => {
    expect(buildInstallCommand({ enrollToken: TOKEN, gatewayUrl: "http://localhost:8787/" })).toContain("CODAI_GATEWAY_URL=http://localhost:8787 sh");
  });

  it("refuses anything that could break out of sh", () => {
    expect(() => buildInstallCommand({ enrollToken: "codai_env_abc; rm -rf /" })).toThrow(/Invalid enrol token/);
    expect(() => buildInstallCommand({ enrollToken: "sk-not-a-token-at-all-1234567890" })).toThrow(/Invalid enrol token/);
    expect(() => buildInstallCommand({ enrollToken: TOKEN, gatewayUrl: "https://x.example/$(id)" })).toThrow(/shell-safe/);
    expect(() => buildInstallCommand({ enrollToken: TOKEN, gatewayUrl: "ftp://x.example" })).toThrow(/http/);
  });
});

describe("redactInstallCommand", () => {
  it("removes the token but keeps the rest of the command loggable", () => {
    const cmd = buildInstallCommand({ enrollToken: TOKEN });
    const safe = redactInstallCommand(cmd);
    expect(safe).not.toContain(TOKEN);
    expect(safe).toContain("CODAI_ENROLL_TOKEN=codai_env_AbCd…");
    expect(safe).toContain("CODAI_GATEWAY_URL=https://ai.codai.ro sh");
  });

  it("redacts tokens embedded in arbitrary installer output", () => {
    expect(redactInstallCommand(`enroll --token ${TOKEN} failed`)).toBe("enroll --token codai_env_AbCd… failed");
  });
});

describe("describeApiKey / hubProjectUrl", () => {
  it("shows only a prefix and the length", () => {
    const d = describeApiKey("codai_sk_0123456789abcdef0123456789abcdef");
    expect(d).toEqual({ prefix: "codai_sk_0…", length: 41 });
  });

  it("builds the hub deep link", () => {
    expect(hubProjectUrl("11111111-2222-3333-4444-555555555555")).toBe("https://hub.codai.ro/projects/11111111-2222-3333-4444-555555555555");
    expect(hubProjectUrl("p", "https://hub.local/")).toBe("https://hub.local/projects/p");
  });
});
