import { describe, expect, it } from "vitest";
import { compare, evaluateSamples, extractValue, renderTemplate } from "./alert-eval";
import type { ProbeMetrics } from "@/lib/probe";

function probe(partial: Partial<ProbeMetrics>): ProbeMetrics {
  return {
    cpu: 0,
    cores: [],
    mem: 0,
    memUsedMb: 0,
    memTotalMb: 0,
    disk: 0,
    diskUsedGb: 0,
    diskTotalGb: 0,
    netIn: 0,
    netOut: 0,
    iopsRead: 0,
    iopsWrite: 0,
    load1: 0,
    load5: 0,
    load15: 0,
    uptimeSec: 0,
    hostname: "test",
    collectedAt: 0,
    ...partial,
  };
}

describe("alert-eval", () => {
  describe("compare", () => {
    it("supports all operators", () => {
      expect(compare(5, ">", 3)).toBe(true);
      expect(compare(5, "<", 3)).toBe(false);
      expect(compare(5, ">=", 5)).toBe(true);
      expect(compare(5, "<=", 5)).toBe(true);
      expect(compare(5, "==", 5)).toBe(true);
      expect(compare(5, "!=", 5)).toBe(false);
    });
  });

  describe("extractValue", () => {
    it("maps every metric name", () => {
      const m = probe({ cpu: 81, mem: 60, disk: 90, netIn: 100, netOut: 200, load1: 2.5, uptimeSec: 12345 });
      expect(extractValue(m, "cpu")).toBe(81);
      expect(extractValue(m, "mem")).toBe(60);
      expect(extractValue(m, "disk")).toBe(90);
      expect(extractValue(m, "net_in")).toBe(100);
      expect(extractValue(m, "net_out")).toBe(200);
      expect(extractValue(m, "load1")).toBe(2.5);
      expect(extractValue(m, "uptime")).toBe(12345);
    });
  });

  describe("renderTemplate", () => {
    it("substitutes placeholders", () => {
      const out = renderTemplate("{{instance}}: {{metric}}={{value}} > {{threshold}}", {
        ruleName: "high cpu",
        metric: "cpu",
        value: 91,
        threshold: 80,
        instanceName: "web-1",
        instanceId: "i-1",
      });
      expect(out).toBe("web-1: cpu=91 > 80");
    });

    it("falls back to id when name missing", () => {
      const out = renderTemplate("{{instance}}", {
        ruleName: "x",
        metric: "cpu",
        value: 1,
        threshold: 0,
        instanceName: null,
        instanceId: "i-42",
      });
      expect(out).toBe("i-42");
    });

    it("provides a default template when null passed", () => {
      const out = renderTemplate(null, {
        ruleName: "rule",
        metric: "cpu",
        value: 50,
        threshold: 80,
        instanceName: null,
        instanceId: null,
      });
      expect(out).toMatch(/rule: cpu=50/);
    });
  });

  describe("evaluateSamples", () => {
    const now = 1_000_000;
    const expr = { metric: "cpu", op: ">", threshold: 80, windowSec: 120 } as const;

    it("returns null when no samples", () => {
      expect(evaluateSamples([], expr, now)).toBeNull();
    });

    it("sustained=false when only one sample matches", () => {
      const r = evaluateSamples([{ value: 95, collectedAt: now - 1000 }], expr, now);
      expect(r?.sustained).toBe(false);
    });

    it("sustained=true when all recent samples match", () => {
      const samples = [
        { value: 90, collectedAt: now - 10_000 },
        { value: 91, collectedAt: now - 30_000 },
        { value: 92, collectedAt: now - 60_000 },
      ];
      const r = evaluateSamples(samples, expr, now);
      expect(r?.sustained).toBe(true);
      expect(r?.latest).toBe(90);
    });

    it("sustained=false when one sample falls under threshold", () => {
      const samples = [
        { value: 90, collectedAt: now - 10_000 },
        { value: 50, collectedAt: now - 30_000 },
        { value: 92, collectedAt: now - 60_000 },
      ];
      const r = evaluateSamples(samples, expr, now);
      expect(r?.sustained).toBe(false);
    });

    it("ignores samples outside the window", () => {
      const samples = [
        { value: 95, collectedAt: now - 1000 },
        { value: 95, collectedAt: now - 200_000 }, // outside 120s window
      ];
      const r = evaluateSamples(samples, expr, now);
      expect(r?.sustained).toBe(false); // only 1 sample inside window
    });
  });
});
