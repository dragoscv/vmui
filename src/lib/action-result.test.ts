import { describe, expect, it } from "vitest";
import { z } from "zod";
import { err, fromZod, ok, type ActionResult } from "./action-result";

describe("action-result", () => {
  it("ok() without data is the bare legacy shape", () => {
    expect(ok()).toEqual({ ok: true });
    expect(Object.keys(ok())).toEqual(["ok"]);
  });

  it("ok(data) carries data", () => {
    const r = ok({ id: 7 });
    expect(r).toEqual({ ok: true, data: { id: 7 } });
    if (r.ok) expect(r.data.id).toBe(7);
  });

  it("err() sets error and omits optional fields when absent", () => {
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
    expect(err("boom", "E_X")).toEqual({ ok: false, error: "boom", code: "E_X" });
    expect(err("boom", undefined, { name: "req" })).toEqual({ ok: false, error: "boom", fieldErrors: { name: "req" } });
  });

  it("is structurally compatible with the legacy union", () => {
    const legacy: { ok: true } | { ok: false; error: string } = Math.random() > 2 ? err("x") : ok();
    const typed: ActionResult = legacy;
    expect(typed.ok).toBe(true);
  });

  it("fromZod uses the first issue as headline and indexes fieldErrors by path", () => {
    const schema = z.object({ name: z.string().min(2, "too short"), age: z.number().int("not int"), nested: z.object({ x: z.string() }) });
    const parsed = schema.safeParse({ name: "a", age: 1.5, nested: { x: 3 } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const r = fromZod(parsed.error);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("validation");
    expect(r.error).toBe("too short");
    expect(r.fieldErrors).toMatchObject({ name: "too short", age: "not int" });
    expect(r.fieldErrors?.["nested.x"]).toBeTypeOf("string");
  });

  it("fromZod keeps the first message per path", () => {
    const schema = z.string().min(5, "first").regex(/^\d+$/, "second");
    const parsed = schema.safeParse("ab");
    if (parsed.success) throw new Error("expected failure");
    const r = fromZod(parsed.error);
    expect(r.fieldErrors).toEqual({ "": "first" });
    expect(r.error).toBe("first");
  });
});
