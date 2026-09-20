import { z } from "zod";

/**
 * Per-key restrictions for `vmui_*` operator keys used by /api/mcp.
 * Stored as JSON in `api_keys.scopes`; `null` means unrestricted.
 *
 * Client-safe: no server-only imports so the settings UI can share the schema.
 */

const idList = z.array(z.string().trim().min(1).max(128)).max(200);

export const apiKeyScopesSchema = z.object({
  /** Allow-listed MCP tool names. Absent = every tool. */
  tools: idList.optional(),
  /** `instances.id` values vm_action may target; vm_sync is matched on `accountId`. */
  vmIds: idList.optional(),
  /** Home Assistant entity ids for lights_set / switch_set / climate_set / media_command / nest_hub_*. */
  entities: idList.optional(),
  /** pc_action verbs. */
  pcActions: idList.optional(),
  /** ha_script names. */
  scripts: idList.optional(),
});

export type ApiKeyScopes = z.infer<typeof apiKeyScopesSchema>;

export const SCOPE_PRESETS = ["all", "readOnly", "nonDestructive"] as const;
export type ScopePreset = (typeof SCOPE_PRESETS)[number];

export type ScopeKeyKind = "vm" | "entity" | "pc" | "script";
export type ScopeKey = { kind: ScopeKeyKind; id: string };

export type ScopedToolInfo = { name: string; destructive?: boolean; readOnly?: boolean };

/** Tool names a preset resolves to, given the catalog. */
export function presetTools(preset: ScopePreset, tools: readonly ScopedToolInfo[]): string[] | undefined {
  if (preset === "all") return undefined;
  if (preset === "readOnly") return tools.filter((t) => t.readOnly).map((t) => t.name);
  return tools.filter((t) => !t.destructive).map((t) => t.name);
}

export function toolAllowed(tool: ScopedToolInfo, scopes: ApiKeyScopes | null | undefined): boolean {
  if (!scopes?.tools) return true;
  return scopes.tools.includes(tool.name);
}

const SCOPE_FIELD: Record<ScopeKeyKind, keyof ApiKeyScopes> = {
  vm: "vmIds",
  entity: "entities",
  pc: "pcActions",
  script: "scripts",
};

export function argsAllowed(key: ScopeKey | undefined, scopes: ApiKeyScopes | null | undefined): boolean {
  if (!key || !scopes) return true;
  const list = scopes[SCOPE_FIELD[key.kind]];
  if (!list) return true;
  return list.includes(key.id);
}

/**
 * Parse the stored JSON column. `null`/empty = unrestricted. Malformed content fails CLOSED
 * (allow nothing) — a corrupted scope row must never silently widen a key.
 */
export function parseApiKeyScopes(raw: string | null | undefined): ApiKeyScopes | null {
  if (!raw) return null;
  try {
    const parsed = apiKeyScopesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DENY_ALL;
  } catch {
    return DENY_ALL;
  }
}

const DENY_ALL: ApiKeyScopes = { tools: [] };

export function isUnrestricted(scopes: ApiKeyScopes | null | undefined): boolean {
  if (!scopes) return true;
  return !scopes.tools && !scopes.vmIds && !scopes.entities && !scopes.pcActions && !scopes.scripts;
}
