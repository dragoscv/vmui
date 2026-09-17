// Mint a vmui_* API key from the CLI (same scrypt format as src/lib/auth.ts).
// Usage: node scripts/mint-api-key.mjs "codai phone" operator
// Prints the plaintext ONCE; store it in the client, never in the repo.
import Database from "better-sqlite3";
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { resolve } from "node:path";

const [name = "cli", role = "operator"] = process.argv.slice(2);
if (!["operator", "viewer"].includes(role)) throw new Error("role must be operator|viewer");

const plaintext = `vmui_${Buffer.from(randomBytes(32)).toString("base64url")}`;
const salt = randomBytes(16);
const key = await new Promise((res, rej) => scrypt(plaintext, salt, 64, (e, k) => (e ? rej(e) : res(k))));
const hash = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;

const db = new Database(resolve(process.cwd(), process.env.VMUI_DB_PATH ?? "./vmui.db"));
db.prepare("INSERT INTO api_keys (id, name, hash, role, rate_limit_per_minute) VALUES (?, ?, ?, ?, 120)").run(randomUUID(), name, hash, role);
db.close();
process.stdout.write(plaintext + "\n");
