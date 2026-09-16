"use server";

import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { setNutritionEvent } from "@/lib/nutrition/events";
import { mealInputSchema, nutritionProfileSchema, type NutritionProfile } from "@/lib/nutrition/schema";
import { addMeal, deleteMeal, saveProfile, updateMeal } from "@/lib/nutrition/store";
import { nutritionSummary, publishToHa } from "@/lib/nutrition/summary";
import { revalidatePath } from "next/cache";
import { z } from "zod";

type Result = { ok: true } | { ok: false; error: string };

async function run(action: string, target: string, message: string, fn: () => Promise<unknown>): Promise<Result> {
  try {
    await requireRole("operator");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not authorized" };
  }
  try {
    await fn();
    await db.insert(auditLog).values({ accountId: "home", action, target, status: "ok", message });
    revalidatePath("/home");
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.insert(auditLog).values({ accountId: "home", action, target, status: "error", message: error });
    return { ok: false, error };
  }
}

async function republish(): Promise<void> {
  const s = await nutritionSummary();
  await publishToHa(s).catch(() => undefined);
}

export async function addMealAction(raw: unknown): Promise<Result> {
  const parsed = mealInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid meal" };
  const input = { ...parsed.data, source: "web" };
  return run("nutrition.meal.add", input.name, `${input.calories} kcal`, async () => {
    const { meal } = await addMeal(input);
    setNutritionEvent({ kind: "meal", at: Date.now(), name: meal.name, calories: meal.calories, mealType: meal.mealType });
    await republish();
  });
}

const patchSchema = mealInputSchema.pick({ name: true, mealType: true, calories: true, protein: true, carbs: true, fats: true, fiber: true, notes: true }).partial();

export async function updateMealAction(id: string, raw: unknown): Promise<Result> {
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid patch" };
  return run("nutrition.meal.update", id, JSON.stringify(parsed.data).slice(0, 200), async () => {
    if (!(await updateMeal(id, parsed.data))) throw new Error("Meal not found");
    await republish();
  });
}

export async function deleteMealAction(id: string): Promise<Result> {
  return run("nutrition.meal.delete", id, "deleted", async () => {
    if (!(await deleteMeal(z.string().min(1).parse(id)))) throw new Error("Meal not found");
    await republish();
  });
}

export async function saveNutritionProfileAction(raw: unknown): Promise<Result> {
  const parsed = nutritionProfileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid profile" };
  const p: NutritionProfile = parsed.data;
  return run("nutrition.profile.save", "profile", `${p.goal} · ${p.activity} · ${p.heightCm} cm`, async () => {
    await saveProfile(p);
    await republish();
  });
}
