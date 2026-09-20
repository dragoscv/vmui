"use client";

import { Stat } from "@/components/ui";
import { formatUsd, formatUsdPerHour, HOURS_PER_MONTH } from "@/lib/utils";
import { quoteInstancePriceAction } from "@/server/actions/pricing";
import { DollarSign } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

interface Props {
  accountId: string;
  provider: string;
  region: string;
  instanceType: string;
  platform: string;
}

export function PriceEstimate({ accountId, provider, region, instanceType, platform }: Props) {
  const t = useTranslations("vm.create");
  const tc = useTranslations("vm.cost");
  const [quote, setQuote] = useState<
    | { usdPerHour: number; source: string }
    | { error: string }
    | null
  >(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!region || !instanceType) {
      setQuote(null);
      return;
    }
    start(async () => {
      const r = await quoteInstancePriceAction({ accountId, provider, region, instanceType, platform });
      if (r.ok) setQuote({ usdPerHour: r.usdPerHour, source: r.source });
      else setQuote({ error: r.error });
    });
  }, [accountId, provider, region, instanceType, platform]);

  const priced = quote && "usdPerHour" in quote ? quote : null;
  return (
    <Stat
      label={t("estimated")}
      icon={<DollarSign />}
      tone="info"
      loading={pending && !quote}
      value={
        priced ? (
          <span className="font-mono text-base tabular-nums">
            {formatUsdPerHour(priced.usdPerHour)} · {tc("perMonth", { price: formatUsd(priced.usdPerHour * HOURS_PER_MONTH) })}
          </span>
        ) : (
          <span className="text-base text-muted">{t("estimateUnavailable")}</span>
        )
      }
      hint={priced ? tc("source", { source: priced.source }) : quote && "error" in quote ? quote.error : undefined}
    />
  );
}
