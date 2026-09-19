import { db } from "@/lib/db";
import { auditLog, pairedDevices, type PairedDeviceRow } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { createHash, randomBytes, randomInt } from "node:crypto";
import "server-only";

// Device pairing for the phone / desktop apps.
//
//   1. the app discovers vmui (mDNS _vmui._tcp on the LAN, Tailscale MagicDNS
//      `homepi` from outside) and POSTs /api/devices/pair with its name.
//      It gets back {id, token, code} and starts polling /api/devices/pair/:id.
//   2. someone approves it: a signed-in vmui user (web, or the desktop app's
//      window), or an already-approved device, after comparing the 4-digit
//      code. Or the app signs in with the vmui account and is approved at once.
//   3. from then on the app authenticates with `Authorization: Bearer <token>`
//      (or ?d=<token>); espAuthorized() accepts both that and the legacy
//      ESP_DISPLAY_TOKEN, so every /api/display, /api/desktop route just works.
//
// Tokens are stored hashed; the clear token lives only on the device.

const PENDING_TTL_MS = 10 * 60_000;

export type DeviceInfo = Omit<PairedDeviceRow, "tokenHash" | "code">;
export type PairingTicket = { id: string; token: string; code: string };

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const strip = (r: PairedDeviceRow): DeviceInfo => {
  const { tokenHash: _h, code: _c, ...rest } = r;
  return rest;
};

/** In-process change counter so clients can long-poll cheaply (GET /api/devices?since=). */
let version = 0;
export const devicesVersion = () => version;
function bump() {
  version++;
}

export async function requestPairing(name: string, platform: string, ip: string | null): Promise<PairingTicket> {
  // one pending request per name+ip; a retry replaces it instead of piling up
  const stale = await db.select().from(pairedDevices).where(eq(pairedDevices.status, "pending"));
  for (const s of stale) {
    if (s.name === name && s.lastIp === ip) await db.delete(pairedDevices).where(eq(pairedDevices.id, s.id));
    else if (s.createdAt.getTime() < Date.now() - PENDING_TTL_MS) await db.delete(pairedDevices).where(eq(pairedDevices.id, s.id));
  }
  const id = randomBytes(8).toString("hex");
  const token = "vmd_" + randomBytes(24).toString("base64url");
  const code = String(randomInt(0, 10000)).padStart(4, "0");
  await db.insert(pairedDevices).values({ id, name: name.slice(0, 64), platform: platform.slice(0, 32), tokenHash: hash(token), status: "pending", code, lastIp: ip, lastSeenAt: new Date() });
  await db.insert(auditLog).values({ accountId: "devices", action: "device.pair.request", target: id, status: "ok", message: `${name} (${platform}) from ${ip ?? "?"} code ${code}` });
  bump();
  return { id, token, code };
}

export async function pairingStatus(id: string): Promise<{ status: string; code: string | null } | null> {
  const r = await db.select().from(pairedDevices).where(eq(pairedDevices.id, id)).get();
  return r ? { status: r.status, code: r.status === "pending" ? r.code : null } : null;
}

export async function approveDevice(id: string, code: string, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await db.select().from(pairedDevices).where(eq(pairedDevices.id, id)).get();
  if (!r || r.status !== "pending") return { ok: false, error: "cerere inexistentă sau expirată" };
  if (r.createdAt.getTime() < Date.now() - PENDING_TTL_MS) return { ok: false, error: "cererea a expirat" };
  if ((r.code ?? "") !== code) return { ok: false, error: "codul nu se potrivește" };
  await db.update(pairedDevices).set({ status: "approved", code: null, approvedBy: by }).where(eq(pairedDevices.id, id));
  await db.insert(auditLog).values({ accountId: "devices", action: "device.pair.approve", target: id, status: "ok", message: `${r.name} approved by ${by}` });
  bump();
  return { ok: true };
}

export async function rejectDevice(id: string, by: string): Promise<void> {
  await db.delete(pairedDevices).where(and(eq(pairedDevices.id, id), eq(pairedDevices.status, "pending")));
  await db.insert(auditLog).values({ accountId: "devices", action: "device.pair.reject", target: id, status: "ok", message: `by ${by}` });
  bump();
}

/** Sign-in path: the device proved it holds the vmui account, so it is approved immediately. */
export async function approveByLogin(name: string, platform: string, ip: string | null, userEmail: string): Promise<PairingTicket> {
  const id = randomBytes(8).toString("hex");
  const token = "vmd_" + randomBytes(24).toString("base64url");
  await db.insert(pairedDevices).values({ id, name: name.slice(0, 64), platform: platform.slice(0, 32), tokenHash: hash(token), status: "approved", approvedBy: userEmail, lastIp: ip, lastSeenAt: new Date() });
  await db.insert(auditLog).values({ accountId: "devices", action: "device.pair.login", target: id, status: "ok", message: `${name} (${platform}) signed in as ${userEmail}` });
  bump();
  return { id, token, code: "" };
}

export async function revokeDevice(id: string, by: string): Promise<void> {
  await db.update(pairedDevices).set({ status: "revoked" }).where(eq(pairedDevices.id, id));
  await db.insert(auditLog).values({ accountId: "devices", action: "device.revoke", target: id, status: "ok", message: `by ${by}` });
  bump();
}

export async function renameDevice(id: string, name: string): Promise<void> {
  await db.update(pairedDevices).set({ name: name.slice(0, 64) }).where(eq(pairedDevices.id, id));
  bump();
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const rows = await db.select().from(pairedDevices).orderBy(desc(pairedDevices.createdAt));
  const cutoff = Date.now() - PENDING_TTL_MS;
  return rows.filter((r) => r.status !== "pending" || r.createdAt.getTime() >= cutoff).map(strip);
}

export async function pendingDevices(): Promise<Array<DeviceInfo & { code: string }>> {
  const rows = await db.select().from(pairedDevices).where(eq(pairedDevices.status, "pending"));
  const cutoff = Date.now() - PENDING_TTL_MS;
  return rows.filter((r) => r.createdAt.getTime() >= cutoff).map((r) => ({ ...strip(r), code: r.code ?? "" }));
}

/** The device behind a request, if its token is approved (for "approved device approves another"). */
export async function deviceFromRequest(req: Request): Promise<DeviceInfo | null> {
  const auth = req.headers.get("authorization") ?? "";
  const tok = auth.startsWith("Bearer ") ? auth.slice(7) : new URL(req.url).searchParams.get("d") ?? "";
  if (!tok.startsWith("vmd_")) return null;
  const r = await db.select().from(pairedDevices).where(eq(pairedDevices.tokenHash, hash(tok))).get();
  if (!r || r.status !== "approved") return null;
  return strip(r);
}
