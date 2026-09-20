import { describe, expect, it } from "vitest";
import { argsAllowed, isUnrestricted, parseApiKeyScopes, presetTools, toolAllowed } from "./api-key-scopes";

const catalog = [
  { name: "vm_list", readOnly: true },
  { name: "vm_sync" },
  { name: "vm_action", destructive: true },
  { name: "door_open", destructive: true },
];

describe("api-key scopes", () => {
  it("null scopes are unrestricted", () => {
    expect(toolAllowed(catalog[2]!, null)).toBe(true);
    expect(argsAllowed({ kind: "vm", id: "x" }, null)).toBe(true);
    expect(isUnrestricted(null)).toBe(true);
    expect(parseApiKeyScopes(null)).toBeNull();
  });

  it("tool allow-list is enforced and filters presets", () => {
    const scopes = { tools: ["vm_list"] };
    expect(toolAllowed(catalog[0]!, scopes)).toBe(true);
    expect(toolAllowed(catalog[2]!, scopes)).toBe(false);
    expect(presetTools("readOnly", catalog)).toEqual(["vm_list"]);
    expect(presetTools("nonDestructive", catalog)).toEqual(["vm_list", "vm_sync"]);
    expect(presetTools("all", catalog)).toBeUndefined();
  });

  it("argument scopes deny anything not listed, including the vm_sync wildcard", () => {
    const scopes = { vmIds: ["acct-1"], entities: ["light.desk"] };
    expect(argsAllowed({ kind: "vm", id: "acct-1" }, scopes)).toBe(true);
    expect(argsAllowed({ kind: "vm", id: "acct-2" }, scopes)).toBe(false);
    expect(argsAllowed({ kind: "vm", id: "*" }, scopes)).toBe(false);
    expect(argsAllowed({ kind: "entity", id: "light.desk" }, scopes)).toBe(true);
    // unscoped dimension stays open
    expect(argsAllowed({ kind: "pc", id: "lock" }, scopes)).toBe(true);
  });

  it("malformed stored scopes fail closed", () => {
    for (const raw of ["{not json", '{"tools": "vm_list"}', '{"tools": [1, 2]}']) {
      const scopes = parseApiKeyScopes(raw);
      expect(scopes).not.toBeNull();
      expect(toolAllowed(catalog[0]!, scopes)).toBe(false);
      expect(isUnrestricted(scopes)).toBe(false);
    }
  });

  it("round-trips valid JSON", () => {
    expect(parseApiKeyScopes('{"tools":["vm_list"],"pcActions":["lock"]}')).toEqual({ tools: ["vm_list"], pcActions: ["lock"] });
  });
});
