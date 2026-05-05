import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface AwsProfile {
  name: string;
  /** From config: region, sso_session, sso_account_id, etc. */
  config: Record<string, string>;
  /** From credentials: access_key, secret, token. */
  credentials: Record<string, string>;
  /** True if it looks like an SSO profile (no static creds). */
  isSso: boolean;
  /** True if static access_key + secret exist directly. */
  hasStaticKeys: boolean;
}

/** Naive INI parser for AWS config/credentials files. */
function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sect = /^\[(.+)\]$/.exec(line);
    if (sect && sect[1]) {
      current = sect[1].trim();
      out[current] = {};
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    out[current]![k] = v;
  }
  return out;
}

export function listAwsProfiles(): AwsProfile[] {
  const home = homedir();
  const credPath = process.env.AWS_SHARED_CREDENTIALS_FILE ?? join(home, ".aws", "credentials");
  const cfgPath = process.env.AWS_CONFIG_FILE ?? join(home, ".aws", "config");

  const credentials = existsSync(credPath) ? parseIni(readFileSync(credPath, "utf8")) : {};
  const config = existsSync(cfgPath) ? parseIni(readFileSync(cfgPath, "utf8")) : {};

  const names = new Set<string>();
  for (const k of Object.keys(credentials)) names.add(k);
  for (const k of Object.keys(config)) {
    // In ~/.aws/config, profiles are written as "[profile name]" except for [default].
    names.add(k.startsWith("profile ") ? k.slice("profile ".length) : k);
  }
  // Drop sso-session entries (they're not profiles).
  for (const n of [...names]) if (n.startsWith("sso-session ")) names.delete(n);

  return [...names].sort().map((name) => {
    const creds = credentials[name] ?? {};
    const cfg = config[name === "default" ? "default" : `profile ${name}`] ?? config[name] ?? {};
    const hasStaticKeys = !!(creds.aws_access_key_id && creds.aws_secret_access_key);
    const isSso = !!(cfg.sso_start_url || cfg.sso_session || cfg.sso_account_id);
    return { name, config: cfg, credentials: creds, isSso, hasStaticKeys };
  });
}

/**
 * Resolve a profile to concrete credentials by shelling out to the AWS CLI.
 * Works for static keys, SSO (after `aws sso login`), assumed roles, etc.
 *
 * Returns null if the AWS CLI is not installed or the profile can't be resolved.
 */
export async function resolveProfileViaCli(
  profileName: string,
): Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string; region?: string } | null> {
  return new Promise((resolve) => {
    const env = { ...process.env, AWS_PROFILE: profileName };
    const child = spawn(
      process.platform === "win32" ? "aws.exe" : "aws",
      ["configure", "export-credentials", "--profile", profileName, "--format", "process"],
      { env, shell: false },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        // Surface CLI error via console for debugging
        if (stderr) console.warn(`[vmui] aws CLI error for profile ${profileName}: ${stderr.trim()}`);
        resolve(null);
        return;
      }
      try {
        const json = JSON.parse(stdout);
        resolve({
          accessKeyId: json.AccessKeyId,
          secretAccessKey: json.SecretAccessKey,
          sessionToken: json.SessionToken,
        });
      } catch {
        resolve(null);
      }
    });
  });
}

/** Whether the AWS CLI binary is on PATH. */
export async function hasAwsCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "aws.exe" : "aws", ["--version"], { shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
