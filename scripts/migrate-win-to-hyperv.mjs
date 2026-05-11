#!/usr/bin/env node
/**
 * One-shot migration: repoint the existing "Local Windows 11 (KVM)"
 * account at the new Hyper-V dispatch path.
 *
 * What it does to the account row:
 *   - decrypt credentials_enc with VMUI_MASTER_KEY (AES-256-GCM)
 *   - flip kind: "win" → "hyperv-win"
 *   - set hostLabel: "Local Windows 11 (Hyper-V)"
 *   - add hypervVmName: "vmui-win" (override with --vmName)
 *   - re-encrypt and write back
 *   - update the row's `name` column to match
 *
 * Idempotent: if the account is already hyperv-win, it prints the current
 * state and exits 0.
 *
 * Usage:
 *   node scripts/migrate-win-to-hyperv.mjs
 *   node scripts/migrate-win-to-hyperv.mjs --account zI1weZ1AKW1m --vmName vmui-win
 *   node scripts/migrate-win-to-hyperv.mjs --dry  # print intended change, no write
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// Tiny .env loader (no extra dep). Reads KEY=VALUE lines, strips quotes.
const envPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".env",
);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};

const dbPath = arg("db", process.env.VMUI_DB_PATH || "./vmui.db");
const requestedAccountId = arg("account", null);
const hypervVmName = arg("vmName", "vmui-win");
const newLabel = arg("label", "Local Windows 11 (Hyper-V)");
const newName = arg("name", newLabel);
const dryRun = flag("dry");

const masterKeyHex = process.env.VMUI_MASTER_KEY;
if (!masterKeyHex || !/^[0-9a-f]{64}$/i.test(masterKeyHex)) {
  console.error("VMUI_MASTER_KEY missing or not 64 hex chars in .env");
  process.exit(1);
}
const key = Buffer.from(masterKeyHex, "hex");

function decryptJSON(payload) {
  const buf = Buffer.from(payload, "base64");
  const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"),
  );
}

function encryptJSON(value) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

const db = new Database(dbPath);

// Find the target row. If --account was given, use it. Otherwise pick the
// single local-kvm row whose decrypted kind === "win".
let row;
if (requestedAccountId) {
  row = db
    .prepare(
      `SELECT id, name, provider, credentials_enc FROM cloud_accounts WHERE id = ?`,
    )
    .get(requestedAccountId);
  if (!row) {
    console.error(`No account with id=${requestedAccountId}`);
    process.exit(2);
  }
} else {
  const candidates = db
    .prepare(
      `SELECT id, name, provider, credentials_enc FROM cloud_accounts WHERE provider = 'local-kvm'`,
    )
    .all();
  const winRows = candidates.filter((r) => {
    try {
      const c = decryptJSON(r.credentials_enc);
      return c.kind === "win" || c.kind === "hyperv-win";
    } catch {
      return false;
    }
  });
  if (winRows.length === 0) {
    console.error(
      "No local-kvm account with kind='win' or 'hyperv-win' found. Pass --account <id>.",
    );
    process.exit(2);
  }
  if (winRows.length > 1) {
    console.error(
      "Multiple matching accounts. Pass --account <id> with one of:",
      winRows.map((r) => `${r.id} (${r.name})`).join(", "),
    );
    process.exit(2);
  }
  row = winRows[0];
}

const creds = decryptJSON(row.credentials_enc);
console.log(`[migrate] Found account ${row.id} "${row.name}" (kind=${creds.kind})`);

if (creds.kind === "hyperv-win") {
  console.log(
    `[migrate] Already hyperv-win; hypervVmName=${creds.hypervVmName ?? "(unset)"}. ` +
      `Nothing to do.`,
  );
  process.exit(0);
}

const next = {
  ...creds,
  kind: "hyperv-win",
  hostLabel: newLabel,
  hypervVmName,
  // The KVM-only fields stay in the blob but are unused by the Hyper-V
  // branch — keeping them avoids losing data if the user reverts.
};

console.log("[migrate] New credentials blob:");
console.log(JSON.stringify(next, null, 2));

if (dryRun) {
  console.log("[migrate] --dry: skipping DB write.");
  process.exit(0);
}

const enc = encryptJSON(next);
const stmt = db.prepare(
  `UPDATE cloud_accounts SET credentials_enc = ?, name = ?, updated_at = ? WHERE id = ?`,
);
const now = Math.floor(Date.now() / 1000);
const info = stmt.run(enc, newName, now, row.id);
console.log(`[migrate] OK. Updated ${info.changes} row(s).`);
