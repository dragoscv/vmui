import "server-only";
import { AlertTriangle } from "lucide-react";
import { detectCostAnomalies } from "@/server/queries/anomalies";
import { env } from "@/lib/env";

let lastWebhookDigest = "";

export async function CostAnomalyBanner() {
  const anomalies = await detectCostAnomalies();
  if (anomalies.length === 0) return null;

  if (env.VMUI_ANOMALY_WEBHOOK) {
    const digest = anomalies.map((a) => `${a.accountId}:${a.currentHourly.toFixed(2)}`).join("|");
    if (digest !== lastWebhookDigest) {
      lastWebhookDigest = digest;
      try {
        await fetch(env.VMUI_ANOMALY_WEBHOOK, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ anomalies }),
          signal: AbortSignal.timeout(5_000),
        });
      } catch (err) {
        console.error("[vmui] anomaly webhook failed", err);
      }
    }
  }

  return (
    <div className="space-y-2">
      {anomalies.map((a) => (
        <div
          key={a.accountId}
          role="alert"
          className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-4 py-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
          <div>
            <div className="font-medium">Cost spike on {a.accountName}</div>
            <div className="text-xs text-muted">{a.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
