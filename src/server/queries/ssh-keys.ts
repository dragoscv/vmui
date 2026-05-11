import "server-only";
import { db } from "@/lib/db";
import { sshKeys } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function listSshKeys() {
  const rows = await db.select().from(sshKeys).orderBy(desc(sshKeys.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    algo: r.algo,
    publicKey: r.publicKey,
    fingerprint: r.fingerprint,
    hasPrivateKey: r.privateKeyEnc !== null,
    notes: r.notes,
    createdAt: r.createdAt,
  }));
}
