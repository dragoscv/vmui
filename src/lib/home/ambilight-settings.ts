import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import "server-only";

// Tunables for the ambilight stack live in ambilight/settings.json and are
// applied by scripts/ambilight.ps1 (one formula, one writer). vmui reads the
// file and shells out to `-Set` so the UI, the CLI and the logon tasks agree.

const ROOT = process.cwd();
const SETTINGS = path.join(ROOT, "ambilight", "settings.json");
const SCRIPT = path.join(ROOT, "scripts", "ambilight.ps1");
const run = promisify(execFile);

export type AmbilightSettings = {
  wallHex: string;
  wallStrength: number;
  gamma: number;
  saturation: number;
  luminance: number;
  grabberFps: number;
  hdrToneMapping: boolean;
};

const DEFAULTS: AmbilightSettings = { wallHex: "#ffffff", wallStrength: 0, gamma: 1.5, saturation: 1, luminance: 1, grabberFps: 60, hdrToneMapping: true };

export async function ambilightSettings(): Promise<AmbilightSettings> {
  try {
    return { ...DEFAULTS, ...(JSON.parse(await readFile(SETTINGS, "utf8")) as Partial<AmbilightSettings>) };
  } catch {
    return DEFAULTS;
  }
}

/** Persist + re-apply via `ambilight.ps1 -Set k=v …`. Throws with the script's last lines on failure. */
export async function setAmbilightSettings(patch: Partial<AmbilightSettings>): Promise<void> {
  // [string[]] parameter: pass one comma-joined argument (positional args after -Set are not accepted).
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-Set", Object.entries(patch).map(([k, v]) => `${k}=${String(v)}`).join(",")];
  const { stdout, stderr } = await run("pwsh", args, { timeout: 60_000, windowsHide: true });
  const out = `${stdout}\n${stderr}`;
  if (!/HyperHDR configured/.test(out)) {
    const tail = out.split("\n").filter((l) => l.trim() && !l.startsWith("VERBOSE")).slice(-3).join(" | ");
    throw new Error(tail || "ambilight.ps1 -Set failed");
  }
}
