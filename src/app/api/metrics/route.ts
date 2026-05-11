import "server-only";

import { db } from "@/lib/db";
import { cloudAccounts, instances, cachedResources, auditLog } from "@/lib/db/schema";
import { sql, gte } from "drizzle-orm";
import { validateApiKey } from "@/lib/api-auth";
import { priceInstances } from "@/lib/pricing";
import { scanCompliance } from "@/server/queries/compliance";
import { HOURS_PER_MONTH } from "@/lib/utils";

/**
 * Prometheus exposition format. Scrape from Grafana/Prometheus with a
 * bearer token (vmui API key, viewer role is enough).
 *
 * Sample scrape config:
 *
 *   scrape_configs:
 *     - job_name: vmui
 *       metrics_path: /api/metrics
 *       authorization:
 *         credentials: vmui_xxx...
 *       static_configs:
 *         - targets: ["127.0.0.1:3737"]
 */

export const dynamic = "force-dynamic";

interface Counter {
  name: string;
  help: string;
  type: "gauge" | "counter";
  samples: { labels?: Record<string, string>; value: number }[];
}

function fmt(counters: Counter[]): string {
  const lines: string[] = [];
  for (const c of counters) {
    lines.push(`# HELP ${c.name} ${c.help}`);
    lines.push(`# TYPE ${c.name} ${c.type}`);
    for (const s of c.samples) {
      const labels = s.labels
        ? "{" +
          Object.entries(s.labels)
            .map(([k, v]) => `${k}="${String(v).replace(/[\\"\n]/g, "_")}"`)
            .join(",") +
          "}"
        : "";
      lines.push(`${c.name}${labels} ${s.value}`);
    }
  }
  return lines.join("\n") + "\n";
}

export async function GET(req: Request) {
  const auth = await validateApiKey(req);
  if (!auth.ok) {
    return new Response(`# error: ${auth.error}\n`, {
      status: auth.status,
      headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
    });
  }

  const [accounts, allInstances, resourceCount, findings, recentErrors] = await Promise.all([
    db.select().from(cloudAccounts),
    db.select().from(instances),
    db
      .select({ provider: cachedResources.provider, kind: cachedResources.kind, c: sql<number>`count(*)` })
      .from(cachedResources)
      .groupBy(cachedResources.provider, cachedResources.kind),
    scanCompliance().catch(() => []),
    db
      .select({ c: sql<number>`count(*)` })
      .from(auditLog)
      .where(
        gte(auditLog.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
  ]);

  const priced = await priceInstances(allInstances).catch(() => null);
  const priceMap = priced ?? {};

  // Per-provider, per-state instance counts.
  const byProviderState = new Map<string, number>();
  for (const i of allInstances) {
    const key = `${i.provider}|${i.state}`;
    byProviderState.set(key, (byProviderState.get(key) ?? 0) + 1);
  }

  const monthlyBurn = allInstances
    .filter((i) => i.state === "running")
    .reduce((sum, i) => sum + (priceMap[i.id]?.usdPerHour ?? 0) * HOURS_PER_MONTH, 0);

  const findingsBySeverity = new Map<string, number>();
  for (const f of findings) {
    findingsBySeverity.set(f.severity, (findingsBySeverity.get(f.severity) ?? 0) + 1);
  }

  const counters: Counter[] = [
    {
      name: "vmui_accounts_total",
      help: "Connected cloud accounts.",
      type: "gauge",
      samples: [{ value: accounts.length }],
    },
    {
      name: "vmui_instances_total",
      help: "Tracked instances by provider and normalized state.",
      type: "gauge",
      samples: [...byProviderState.entries()].map(([k, v]) => {
        const [provider, state] = k.split("|");
        return { labels: { provider: provider ?? "unknown", state: state ?? "unknown" }, value: v };
      }),
    },
    {
      name: "vmui_resources_total",
      help: "Cached non-instance resources by provider and kind.",
      type: "gauge",
      samples: resourceCount.map((r) => ({
        labels: { provider: r.provider, kind: r.kind },
        value: Number(r.c),
      })),
    },
    {
      name: "vmui_monthly_burn_usd",
      help: "Estimated monthly USD burn of currently-running instances.",
      type: "gauge",
      samples: [{ value: Math.round(monthlyBurn * 100) / 100 }],
    },
    {
      name: "vmui_compliance_findings",
      help: "Open compliance findings grouped by severity.",
      type: "gauge",
      samples: (["critical", "high", "medium", "low"] as const).map((sev) => ({
        labels: { severity: sev },
        value: findingsBySeverity.get(sev) ?? 0,
      })),
    },
    {
      name: "vmui_audit_errors_last_hour",
      help: "Number of error-tagged audit-log entries in the last hour.",
      type: "gauge",
      samples: [{ value: Number(recentErrors[0]?.c ?? 0) }],
    },
  ];

  return new Response(fmt(counters), {
    status: 200,
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
