import type { ZodError } from "zod";

export type ActionOk<T = void> = T extends void ? { ok: true } : { ok: true; data: T };
export type ActionErr = { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };
export type ActionResult<T = void> = ActionOk<T> | ActionErr;

export function ok(): ActionOk<void>;
export function ok<T>(data: T): ActionOk<T>;
export function ok<T>(...args: [] | [T]): ActionOk<T> | ActionOk<void> {
  if (args.length === 0) return { ok: true } as ActionOk<void>;
  return { ok: true, data: args[0] } as ActionOk<T>;
}

export const err = (error: string, code?: string, fieldErrors?: Record<string, string>): ActionErr => ({
  ok: false,
  error,
  ...(code !== undefined ? { code } : {}),
  ...(fieldErrors !== undefined ? { fieldErrors } : {}),
});

/** First issue becomes the headline; every issue is indexed by its dotted path
 *  (first one wins per path) so forms can highlight fields. */
export function fromZod(e: ZodError): ActionErr {
  const fieldErrors: Record<string, string> = {};
  for (const issue of e.issues) {
    const path = issue.path.map(String).join(".");
    if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
  }
  return err(e.issues[0]?.message ?? "Invalid input", "validation", fieldErrors);
}
