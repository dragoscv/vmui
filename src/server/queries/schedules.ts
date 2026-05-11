import "server-only";
import { db } from "@/lib/db";
import { schedules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function listSchedules() {
  return db.select().from(schedules);
}

export async function listSchedulesForInstance(instanceId: string) {
  return db.select().from(schedules).where(eq(schedules.instanceId, instanceId));
}
