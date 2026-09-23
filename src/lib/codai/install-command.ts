export const DEFAULT_CODAI_GATEWAY_URL = "https://ai.codai.ro";
export const CODAI_INSTALL_SCRIPT_URL = "https://codai.ro/install-codaid.sh";
export const CODAI_HUB_URL = "https://hub.codai.ro";

const ENROLL_TOKEN_RE = /^codai_env_[A-Za-z0-9]{16,}$/;
const SHELL_SAFE_RE = /^[A-Za-z0-9_./:@%+=-]+$/;

export interface InstallCommandInput {
  enrollToken: string;
  gatewayUrl?: string;
}

function assertShellSafe(name: string, value: string): void {
  if (!SHELL_SAFE_RE.test(value)) throw new Error(`${name} contains characters that are not shell-safe`);
}

/**
 * The exact one-liner `apps/codaid/install.sh` documents for non-interactive
 * (cloud-init / vmui) enrolment. Every interpolated value is validated against
 * a strict character class so the command can never break out of `sh`.
 */
export function buildInstallCommand(input: InstallCommandInput): string {
  if (!ENROLL_TOKEN_RE.test(input.enrollToken)) throw new Error("Invalid enrol token");
  const gateway = (input.gatewayUrl ?? DEFAULT_CODAI_GATEWAY_URL).replace(/\/+$/, "");
  if (!/^https?:\/\//.test(gateway)) throw new Error("Gateway URL must be http(s)");
  assertShellSafe("gateway URL", gateway);
  return `curl -fsSL ${CODAI_INSTALL_SCRIPT_URL} | CODAI_ENROLL_TOKEN=${input.enrollToken} CODAI_GATEWAY_URL=${gateway} sh`;
}

/** What may be logged or shown as "the command that ran": token replaced by a prefix. */
export function redactInstallCommand(command: string): string {
  return command.replace(/codai_env_[A-Za-z0-9]+/g, (m) => `${m.slice(0, 14)}…`);
}

/** `codai_xxxx…` + length, never the key itself. */
export function describeApiKey(key: string): { prefix: string; length: number } {
  return { prefix: `${key.slice(0, 10)}…`, length: key.length };
}

export function hubProjectUrl(projectId: string, hubUrl: string = CODAI_HUB_URL): string {
  return `${hubUrl.replace(/\/+$/, "")}/projects/${encodeURIComponent(projectId)}`;
}
