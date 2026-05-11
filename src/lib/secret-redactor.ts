import "server-only";

export interface RedactionResult {
  text: string;
  hits: { pattern: string; count: number }[];
}

interface Rule {
  name: string;
  re: RegExp;
  replace: (match: string) => string;
}

function mask(match: string, keep = 4): string {
  if (match.length <= keep * 2) return "*".repeat(match.length);
  return `${match.slice(0, keep)}…${"*".repeat(Math.min(8, match.length - keep * 2))}…${match.slice(-keep)}`;
}

const RULES: Rule[] = [
  {
    name: "aws_access_key_id",
    re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: (m) => `[redacted:aws-key ${mask(m)}]`,
  },
  {
    name: "aws_secret_access_key",
    re: /\b[A-Za-z0-9/+=]{40}\b(?=[\s"',]|$)/g,
    replace: (m) => `[redacted:aws-secret ${mask(m, 2)}]`,
  },
  {
    name: "github_pat",
    re: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,255}\b/g,
    replace: (m) => `[redacted:gh-token ${mask(m)}]`,
  },
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: (m) => `[redacted:jwt ${mask(m)}]`,
  },
  {
    name: "openai_key",
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    replace: (m) => `[redacted:openai ${mask(m)}]`,
  },
  {
    name: "bearer_header",
    re: /\b(Bearer|Authorization:\s*Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: () => `[redacted:bearer]`,
  },
  {
    name: "private_key_pem",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => `[redacted:pem-private-key]`,
  },
  {
    name: "ssh_private_key_inline",
    re: /\b(ssh-rsa|ssh-ed25519|ssh-dss|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{60,}\b/g,
    replace: () => `[redacted:ssh-key]`,
  },
  {
    name: "iban_ro",
    re: /\bRO\d{2}[A-Z]{4}[A-Z0-9]{16}\b/g,
    replace: (m) => `[redacted:iban ${mask(m)}]`,
  },
  {
    name: "cnp_ro",
    re: /\b[1-8]\d{12}\b/g,
    replace: (m) => `[redacted:cnp ${m.slice(0, 1)}**********${m.slice(-2)}]`,
  },
  {
    name: "password_assignment",
    re: /(["']?(?:password|passwd|pwd|api[_-]?key|token|secret)["']?\s*[:=]\s*["'])[^"'\n]{4,}(["'])/gi,
    replace: (_m) => _m.replace(/[^"'\n]{4,}(?=["']\s*$)/, "[redacted]"),
  },
  {
    name: "uuid",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    replace: (m) => `${m.slice(0, 8)}-****-****-****-${m.slice(-12)}`,
  },
];

export function redact(text: string): RedactionResult {
  const hits: { pattern: string; count: number }[] = [];
  let out = text;
  for (const rule of RULES) {
    let count = 0;
    out = out.replace(rule.re, (m) => {
      count++;
      return rule.replace(m);
    });
    if (count > 0) hits.push({ pattern: rule.name, count });
  }
  return { text: out, hits };
}

export function redactQuiet(text: string): string {
  return redact(text).text;
}

export const REDACTION_RULE_NAMES = RULES.map((r) => r.name);
