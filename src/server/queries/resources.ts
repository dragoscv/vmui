import "server-only";
import { db } from "@/lib/db";
import { cachedResources } from "@/lib/db/schema";

export async function listAllResources() {
  return db.select().from(cachedResources).orderBy(cachedResources.kind, cachedResources.name);
}
