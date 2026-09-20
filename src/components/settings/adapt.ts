import { err, ok, type ActionErr, type ActionResult } from "@/lib/action-result";

/** Older settings actions return `{ ok: boolean; error?: string }`; `useAction` wants a discriminated `ActionResult`. */
export function toResult(r: { ok: boolean; error?: string | null }): ActionResult {
  return r.ok ? ok() : err(r.error ?? "common.error");
}

/** Same, for actions that carry a payload on success: only the failure half needs adapting. */
export function toError(r: { error?: string | null }): ActionErr {
  return err(r.error ?? "common.error");
}
