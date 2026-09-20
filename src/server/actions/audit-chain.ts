"use server";

import { err, ok, type ActionResult } from "@/lib/action-result";
import { verifyAuditChain, type VerifyResult } from "@/lib/audit-chain";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { revalidatePath } from "next/cache";

export async function verifyAuditChainAction(): Promise<ActionResult<VerifyResult>> {
  await requireRole("viewer");
  try {
    const r = await verifyAuditChain();
    db.insert(auditLog).values({ action: "audit-chain.verify", status: r.ok ? "ok" : "error", message: r.reason ?? `${r.segments} segments` }).run();
    revalidatePath("/audit-chain");
    return ok(r);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
