"use server";

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { requireOwner } from "@/lib/home/access";
import { buttonBindingsSchema, describeAction, saveButtonBindings, type ButtonBindings, type Gesture } from "@/lib/home/button-bindings";
import { runButtonGesture } from "@/lib/home/button-run";
import { revalidatePath } from "next/cache";

type Result = { ok: true; message?: string } | { ok: false; error: string };

export async function saveButtonBindingsAction(input: ButtonBindings): Promise<Result> {
  const parsed = buttonBindingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  try {
    await requireOwner();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  await saveButtonBindings(parsed.data);
  const summary = Object.entries(parsed.data.gestures).map(([g, a]) => `${g}=${describeAction(a)}`).join("; ");
  await db.insert(auditLog).values({ accountId: "home", action: "button.bindings.save", target: "desk", status: "ok", message: summary });
  revalidatePath("/home");
  return { ok: true };
}

export async function testButtonGestureAction(gesture: Gesture): Promise<Result> {
  try {
    await requireOwner();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  try {
    const r = await runButtonGesture(gesture, "web-test");
    revalidatePath("/home");
    return { ok: true, message: r.result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
