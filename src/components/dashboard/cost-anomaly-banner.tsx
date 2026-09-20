import { Alert, Button } from "@/components/ui";
import { env } from "@/lib/env";
import { formatUsd, HOURS_PER_MONTH } from "@/lib/utils";
import { detectCostAnomalies } from "@/server/queries/anomalies";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import "server-only";

let lastWebhookDigest = "";

export async function CostAnomalyBanner() {
  const anomalies = await detectCostAnomalies();
  if (anomalies.length === 0) return null;
  const t = await getTranslations("dashboard.anomaly");

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
        <Alert
          key={a.accountId}
          tone="warning"
          title={t("title", { account: a.accountName })}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/costs">{t("view")}</Link>
            </Button>
          }
        >
          {t(a.ratio > 0 ? "body" : "bodyNoRatio", {
            current: formatUsd(a.currentHourly),
            ratio: a.ratio.toFixed(1),
            median: formatUsd(a.median7dHourly),
            monthly: formatUsd(a.currentHourly * HOURS_PER_MONTH),
          })}
        </Alert>
      ))}
    </div>
  );
}
