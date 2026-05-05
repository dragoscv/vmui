// One-shot: update existing local-kvm account credentials to use Ubuntu-24.04 instead of Ubuntu.
// Decrypts credentialsEnc, mutates `distro`, re-encrypts, writes back.
import Database from "better-sqlite3";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_HEX = process.env.VMUI_MASTER_KEY;
if (!KEY_HEX) {
  console.error("VMUI_MASTER_KEY missing from .env");
  process.exit(1);
}
const key = Buffer.from(KEY_HEX, "hex");

function decryptJSON(b64) {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}
function encryptJSON(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

const db = new Database("vmui.db");
const rows = db.prepare("SELECT id, name, provider, credentials_enc FROM cloud_accounts WHERE provider = 'local-kvm'").all();
console.log(`Found ${rows.length} local-kvm accounts`);
for (const r of rows) {
  const creds = decryptJSON(r.credentials_enc);
  console.log(`- ${r.name} (${r.id}): distro=${creds.distro}`);
  if (creds.distro !== "Ubuntu-24.04") {
    creds.distro = "Ubuntu-24.04";
    const enc = encryptJSON(creds);
    db.prepare("UPDATE cloud_accounts SET credentials_enc = ? WHERE id = ?").run(enc, r.id);
    console.log(`  → updated to Ubuntu-24.04`);
  } else {
    console.log(`  (already Ubuntu-24.04)`);
  }
}
db.close();
