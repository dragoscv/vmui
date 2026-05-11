/**
 * Categorize raw provider errors into one of a few well-known buckets so the
 * UI can show actionable hints. Pure function — safe to call from server or
 * client. Falls back to "other" with the original message preserved so we
 * never lose information.
 */

export type ProviderErrorKind = "auth" | "permission" | "rate" | "notfound" | "quota" | "network" | "other";

export interface CategorizedError {
  kind: ProviderErrorKind;
  message: string;
  hint: string | null;
}

const HINTS: Record<ProviderErrorKind, string | null> = {
  auth: "Check that the credentials on the account page are still valid.",
  permission: "The credential is missing the required IAM/RBAC permission.",
  rate: "Provider rate-limited the request. It usually clears within a minute.",
  notfound: "The resource may have been deleted or you're targeting the wrong region.",
  quota: "Provider quota exceeded — request a quota increase or pick another region.",
  network: "Network glitch reaching the provider. Retry should work.",
  other: null,
};

export function categorizeError(err: unknown): CategorizedError {
  const message = err instanceof Error ? err.message : String(err);
  const lc = message.toLowerCase();

  let kind: ProviderErrorKind = "other";
  if (/(invalid.*credential|auth(?!or)|signature|unauthorized|expired token|invalid client token)/i.test(lc)) {
    kind = "auth";
  } else if (/(forbidden|access denied|not authorized|insufficient.*permission|requires.*role)/i.test(lc)) {
    kind = "permission";
  } else if (/(throttl|rate.?limit|too many requests|429|requestlimitexceeded)/i.test(lc)) {
    kind = "rate";
  } else if (/(quota|limit exceeded|resourcequota|resource(.|s).?(in|over)?.?use)/i.test(lc)) {
    kind = "quota";
  } else if (/(not.?found|does not exist|404|noSuch|invalidinstanceid)/i.test(lc)) {
    kind = "notfound";
  } else if (/(econnreset|etimedout|enotfound|network|fetch failed|socket hang up)/i.test(lc)) {
    kind = "network";
  }

  return { kind, message, hint: HINTS[kind] };
}
