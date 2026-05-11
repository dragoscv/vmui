import "server-only";
import { db } from "@/lib/db";
import { tagPolicies, instances, instanceTags, type InstanceRow } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Tiny DSL: clauses joined by AND/OR, each clause is `field OP value`.
 * Fields: provider, region, name, state, instanceType, tag.<key>
 * Operators: =, !=, ~  (regex match), !~
 * Value: bareword or "quoted string"
 *
 * Example:
 *   provider=aws AND region~^eu AND tag.env=prod
 */

type ClauseOp = "=" | "!=" | "~" | "!~";
interface Clause { field: string; op: ClauseOp; value: string; }
interface Expression { clauses: Clause[]; joiners: ("AND" | "OR")[]; }

function tokenizeValue(input: string): { value: string; rest: string } {
  const m = input.match(/^"((?:[^"\\]|\\.)*)"\s*(.*)$/) ?? input.match(/^(\S+)\s*(.*)$/);
  if (!m) return { value: "", rest: input };
  return { value: m[1] ?? "", rest: m[2] ?? "" };
}

export function parseExpression(src: string): Expression {
  const clauses: Clause[] = [];
  const joiners: ("AND" | "OR")[] = [];
  let rest = src.trim();
  while (rest.length > 0) {
    const m = rest.match(/^([\w.]+)\s*(!~|!=|~|=)\s*(.*)$/);
    if (!m) break;
    const field = m[1] ?? "";
    const op = m[2] as ClauseOp;
    const { value, rest: r2 } = tokenizeValue(m[3] ?? "");
    clauses.push({ field, op, value });
    rest = r2.trim();
    if (rest.length === 0) break;
    const j = rest.match(/^(AND|OR)\s+(.*)$/i);
    if (!j) break;
    joiners.push((j[1] ?? "AND").toUpperCase() as "AND" | "OR");
    rest = j[2] ?? "";
  }
  return { clauses, joiners };
}

function getField(inst: InstanceRow, field: string, tags: Record<string, string>): string {
  if (field.startsWith("tag.")) return tags[field.slice(4)] ?? "";
  switch (field) {
    case "provider": return inst.provider;
    case "region": return inst.region;
    case "name": return inst.name ?? "";
    case "state": return inst.state ?? "";
    case "instanceType": return inst.instanceType ?? "";
    default: return "";
  }
}

function evalClause(c: Clause, inst: InstanceRow, tags: Record<string, string>): boolean {
  const v = getField(inst, c.field, tags);
  switch (c.op) {
    case "=": return v === c.value;
    case "!=": return v !== c.value;
    case "~": try { return new RegExp(c.value).test(v); } catch { return false; }
    case "!~": try { return !new RegExp(c.value).test(v); } catch { return false; }
  }
}

export function evaluateExpression(expr: Expression, inst: InstanceRow, tags: Record<string, string>): boolean {
  if (expr.clauses.length === 0) return true;
  let result = evalClause(expr.clauses[0]!, inst, tags);
  for (let i = 0; i < expr.joiners.length; i++) {
    const c = expr.clauses[i + 1];
    if (!c) break;
    const next = evalClause(c, inst, tags);
    result = expr.joiners[i] === "AND" ? (result && next) : (result || next);
  }
  return result;
}

export interface PolicyViolation {
  policyId: string; policyName: string;
  instanceId: string; instanceName: string;
  missingKeys: string[];
}

export async function evaluateTagPolicies(): Promise<PolicyViolation[]> {
  const [policies, allInstances] = await Promise.all([
    db.select().from(tagPolicies).where(eq(tagPolicies.enabled, true)),
    db.select().from(instances),
  ]);
  const violations: PolicyViolation[] = [];
  for (const inst of allInstances) {
    const tagRows = await db.select().from(instanceTags).where(eq(instanceTags.instanceId, inst.id));
    const tags: Record<string, string> = {};
    for (const t of tagRows) tags[t.key] = t.value;
    for (const p of policies) {
      const expr = parseExpression(p.condition);
      if (!evaluateExpression(expr, inst, tags)) continue;
      let required: string[] = [];
      try { required = JSON.parse(p.requireKeysJson) as string[]; } catch { required = []; }
      const missing = required.filter((k) => !(k in tags) || tags[k] === "");
      if (missing.length > 0) {
        violations.push({
          policyId: p.id, policyName: p.name,
          instanceId: inst.id, instanceName: inst.name ?? inst.providerInstanceId,
          missingKeys: missing,
        });
      }
    }
  }
  return violations;
}
