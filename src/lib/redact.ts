/**
 * Strips obvious secrets from an arbitrary error/string before it's written
 * to the audit log or rendered in the UI. Pure function; preserves the
 * surrounding text so debugging stays possible.
 *
 * Patterns covered (case-insensitive):
 *   - AWS access keys (AKIA / ASIA + 16 chars)
 *   - AWS / generic 40-char base64 secrets following an `=` or `:` or whitespace
 *   - `Authorization: Bearer <token>` headers
 *   - JSON-shape `"password"|"secret"|"token"|"apiKey"|"clientSecret": "..."`
 *   - PEM private-key blocks (-----BEGIN ... PRIVATE KEY-----)
 *   - `password=...` and `secret=...` in query/form strings
 */

const REDACTED = "[redacted]";

const PATTERNS: Array<[RegExp, string]> = [
  [/(AKIA|ASIA)[0-9A-Z]{12,20}/g, `$1${"X".repeat(16)}`],
  [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, `$1\n${REDACTED}\n$2`],
  [/(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._\-+/=]+/gi, `$1${REDACTED}`],
  [/("(?:password|secret|token|api[_-]?key|client[_-]?secret|private[_-]?key|access[_-]?key)"\s*:\s*")[^"]+(")/gi, `$1${REDACTED}$2`],
  [/((?:password|secret|token|api[_-]?key|client[_-]?secret|access[_-]?key)\s*=\s*)[^\s&;,'"]+/gi, `$1${REDACTED}`],
];

export function redactSecrets(input: unknown): string {
  let s = typeof input === "string" ? input : input instanceof Error ? input.message : safeJson(input);
  for (const [re, replacement] of PATTERNS) {
    s = s.replace(re, replacement);
  }
  return s;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
