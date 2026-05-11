import "server-only";
import { createHash, createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { auditLog, auditChain } from "@/lib/db/schema";
import { gt, asc, desc } from "drizzle-orm";
import { requireMasterKey } from "@/lib/env";

const GENESIS = "0".repeat(64);

function rowDigest(row: { id: number; createdAt: Date; accountId: string | null; action: string; target: string | null; status: string | null; message: string | null }): string {
  const canon = JSON.stringify([row.id, row.createdAt.toISOString(), row.accountId ?? "", row.action, row.target ?? "", row.status ?? "", row.message ?? ""]);
  return createHash("sha256").update(canon).digest("hex");
}

function chunkHash(prevHash: string, rowHashes: string[]): string {
  const h = createHash("sha256");
  h.update(prevHash);
  for (const rh of rowHashes) h.update(rh);
  return h.digest("hex");
}

function chunkHmac(hash: string): string {
  const key = requireMasterKey();
  return createHmac("sha256", key).update(hash).digest("hex");
}

let _lastRun = 0;

/** Append a new chain segment covering all auditLog rows since last segment. */
export async function appendAuditChain(maxBatch = 500): Promise<{ appended: number; lastId: number | null }> {
  const lastSeg = await db.select().from(auditChain).orderBy(desc(auditChain.toAuditId)).limit(1);
  const fromId = lastSeg[0]?.toAuditId ?? 0;
  const prevHash = lastSeg[0]?.hash ?? GENESIS;

  const rows = await db.select().from(auditLog).where(gt(auditLog.id, fromId)).orderBy(asc(auditLog.id)).limit(maxBatch);
  if (rows.length === 0) return { appended: 0, lastId: fromId || null };

  const rowHashes = rows.map(rowDigest);
  const hash = chunkHash(prevHash, rowHashes);
  const hmac = chunkHmac(hash);
  const lastRow = rows[rows.length - 1];
  if (!lastRow) return { appended: 0, lastId: fromId || null };

  await db.insert(auditChain).values({
    fromAuditId: rows[0]!.id,
    toAuditId: lastRow.id,
    prevHash, hash, hmac,
  });
  return { appended: rows.length, lastId: lastRow.id };
}

export async function maybeAppendAuditChain() {
  const now = Date.now();
  if (now - _lastRun < 5 * 60_000) return;
  _lastRun = now;
  await appendAuditChain().catch(() => undefined);
}

export interface VerifyResult {
  ok: boolean;
  segments: number;
  firstBadSegmentId: number | null;
  reason: string | null;
}

export async function verifyAuditChain(): Promise<VerifyResult> {
  const segs = await db.select().from(auditChain).orderBy(asc(auditChain.id));
  let prevHash = GENESIS;
  for (const seg of segs) {
    if (seg.prevHash !== prevHash) {
      return { ok: false, segments: segs.length, firstBadSegmentId: seg.id, reason: `prev_hash mismatch at segment ${seg.id}` };
    }
    const rows = await db.select().from(auditLog).where(gt(auditLog.id, seg.fromAuditId - 1)).orderBy(asc(auditLog.id));
    const inSeg = rows.filter((r) => r.id >= seg.fromAuditId && r.id <= seg.toAuditId);
    const rowHashes = inSeg.map(rowDigest);
    const computed = chunkHash(prevHash, rowHashes);
    if (computed !== seg.hash) {
      return { ok: false, segments: segs.length, firstBadSegmentId: seg.id, reason: `row hash mismatch at segment ${seg.id}` };
    }
    if (chunkHmac(seg.hash) !== seg.hmac) {
      return { ok: false, segments: segs.length, firstBadSegmentId: seg.id, reason: `hmac mismatch at segment ${seg.id} (master key changed?)` };
    }
    prevHash = seg.hash;
  }
  return { ok: true, segments: segs.length, firstBadSegmentId: null, reason: null };
}
