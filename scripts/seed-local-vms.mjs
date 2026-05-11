// One-off helper: insert local-kvm accounts for win + ubuntu kinds.
// Re-runnable: skips kinds that already exist (matched by metadata accountId).
// Run with: pnpm node scripts/seed-local-vms.mjs

import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

// --- load .env (simple parser, no deps) ---
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const masterKey = process.env.VMUI_MASTER_KEY;
if (!masterKey || !/^[0-9a-f]{64}$/i.test(masterKey)) {
  throw new Error("VMUI_MASTER_KEY missing or invalid in .env");
}
const key = Buffer.from(masterKey, "hex");

function encryptJSON(value) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function nanoid(n = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const bytes = randomBytes(n);
  for (let i = 0; i < n; i++) id += chars[bytes[i] % chars.length];
  return id;
}

const dbPath = resolve(process.cwd(), process.env.VMUI_DB_PATH ?? "./vmui.db");
const db = new Database(dbPath);

const KINDS = [
  {
    kind: "win",
    name: "Local Windows 11 (KVM)",
    creds: {
      kind: "win",
      distro: "Ubuntu-24.04",
      vmDir: "/home/dragos/vmui-vms/win",
      hostLabel: "Local Windows 11 (KVM)",
      vncPort: 6900,
      qmpPort: 4445,
      sshPort: 10023,
      wsPort: 6090,
      ramMb: 8192,
      cores: 4,
      threads: 8,
    },
    accountId: "wsl-local-win",
    label: "Local Windows 11 (KVM)",
  },
  {
    kind: "ubuntu",
    name: "Local Ubuntu LTS (KVM)",
    creds: {
      kind: "ubuntu",
      distro: "Ubuntu-24.04",
      vmDir: "/home/dragos/vmui-vms/ubuntu",
      hostLabel: "Local Ubuntu LTS (KVM)",
      vncPort: 7900,
      qmpPort: 4446,
      sshPort: 10024,
      wsPort: 6100,
      ramMb: 4096,
      cores: 2,
      threads: 4,
    },
    accountId: "wsl-local-ubuntu",
    label: "Local Ubuntu LTS (KVM)",
  },
];

// detect existing rows by decrypting metadata is overkill — instead match on
// (provider, name) which is unique enough for our purpose.
const existing = db
  .prepare("SELECT id, name FROM cloud_accounts WHERE provider = ?")
  .all("local-kvm");
const existingNames = new Set(existing.map((r) => r.name));

const insert = db.prepare(`
  INSERT INTO cloud_accounts
    (id, provider, name, default_region, credentials_enc, metadata_enc, created_at, updated_at)
  VALUES (?, 'local-kvm', ?, 'wsl-local', ?, ?, ?, ?)
`);
const auditInsert = db.prepare(`
  INSERT INTO audit_log (account_id, action, target, status, message, created_at)
  VALUES (?, 'account.create', ?, 'ok', ?, ?)
`);

const now = Math.floor(Date.now() / 1000);
const inserted = [];
for (const k of KINDS) {
  if (existingNames.has(k.name)) {
    console.log(`skip: account "${k.name}" already exists`);
    continue;
  }
  const id = nanoid(12);
  insert.run(
    id,
    k.name,
    encryptJSON(k.creds),
    encryptJSON({ accountId: k.accountId, label: k.label }),
    now,
    now,
  );
  auditInsert.run(id, k.accountId, `Local KVM host "${k.name}" connected (${k.label}) [seed]`, now);
  inserted.push({ id, kind: k.kind, name: k.name });
  console.log(`inserted: ${k.name} (id=${id}, kind=${k.kind})`);
}

console.log(JSON.stringify({ inserted }, null, 2));
db.close();
