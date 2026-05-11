/**
 * Tiny cron expression matcher. Supports the standard 5-field form:
 *   minute  hour  day-of-month  month  day-of-week
 * Each field accepts: "*", "a", "a-b", "*\/n", and comma-separated lists.
 * day-of-week: 0 or 7 == Sunday.
 *
 * matchesNow(cron, date) returns true if `date` falls inside the minute-window
 * described by the cron expression. Designed for a per-minute scanner — DO NOT
 * call it more than once per minute for the same schedule, or you will run
 * actions repeatedly inside the same matching minute.
 */

function expandField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let step = 1;
    let body = part;
    const stepIdx = part.indexOf("/");
    if (stepIdx >= 0) {
      step = Number(part.slice(stepIdx + 1));
      body = part.slice(0, stepIdx);
      if (!Number.isFinite(step) || step <= 0) throw new Error(`Bad step in cron field: ${field}`);
    }
    let lo = min;
    let hi = max;
    if (body !== "*" && body !== "") {
      const dash = body.indexOf("-");
      if (dash >= 0) {
        lo = Number(body.slice(0, dash));
        hi = Number(body.slice(dash + 1));
      } else {
        lo = Number(body);
        hi = lo;
      }
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error(`Bad cron field: ${field}`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
}

export function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron must have 5 fields, got: ${expr}`);
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const dowSet = expandField(dow, 0, 7);
  if (dowSet.has(7)) {
    dowSet.delete(7);
    dowSet.add(0);
  }
  return {
    minute: expandField(m, 0, 59),
    hour: expandField(h, 0, 23),
    dom: expandField(dom, 1, 31),
    month: expandField(mon, 1, 12),
    dow: dowSet,
  };
}

export function matchesNow(expr: string, now: Date = new Date()): boolean {
  let p: ParsedCron;
  try {
    p = parseCron(expr);
  } catch {
    return false;
  }
  return (
    p.minute.has(now.getMinutes()) &&
    p.hour.has(now.getHours()) &&
    p.dom.has(now.getDate()) &&
    p.month.has(now.getMonth() + 1) &&
    p.dow.has(now.getDay())
  );
}

/**
 * Return the next time-of-fire after `from`, walking forward minute by
 * minute and short-circuiting on field misses. Bounded to the next year so
 * malformed-but-valid expressions like "0 0 31 2 *" return null instead of
 * spinning forever.
 */
export function nextRun(expr: string, from: Date = new Date()): Date | null {
  let p: ParsedCron;
  try {
    p = parseCron(expr);
  } catch {
    return null;
  }
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);
  while (cursor.getTime() <= limit.getTime()) {
    if (!p.month.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!p.dom.has(cursor.getDate()) || !p.dow.has(cursor.getDay())) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    if (!p.hour.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!p.minute.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
      continue;
    }
    return cursor;
  }
  return null;
}

/**
 * Return up to `count` upcoming run timestamps for the cron expression. Used
 * by the UI to preview a schedule before it is saved.
 */
export function nextRuns(expr: string, count = 5, from: Date = new Date()): Date[] {
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const nr = nextRun(expr, cursor);
    if (!nr) break;
    out.push(nr);
    cursor = new Date(nr.getTime() + 60_000);
  }
  return out;
}
