import type { InstanceRow } from "@/lib/db/schema";

/** Resolve a user-facing label for an instance, preferring user rename. */
export function instanceLabel(i: Pick<InstanceRow, "displayName" | "name" | "providerInstanceId">) {
  return (
    i.displayName?.trim() ||
    i.name?.trim() ||
    i.providerInstanceId
  );
}
