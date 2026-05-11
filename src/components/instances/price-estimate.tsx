"use client";

import { useEffect, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { DollarSign, Loader2 } from "lucide-react";
import { quoteInstancePriceAction } from "@/server/actions/pricing";
import { formatUsd, formatUsdPerHour, HOURS_PER_MONTH } from "@/lib/utils";

interface Props {
  accountId: string;
  provider: string;
  region: string;
  instanceType: string;
  platform: string;
}

export function PriceEstimate({ accountId, provider, region, instanceType, platform }: Props) {
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

  return (
    <motion.div
      layout
      className="flex items-center justify-between gap-4 rounded-md border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-primary)_8%,transparent)] px-4 py-3"
    >
      <div className="flex items-center gap-2 text-xs text-muted">
        <DollarSign className="h-4 w-4 text-[var(--color-primary)]" />
        <span>Estimated cost</span>
        {pending && <Loader2 className="h-3 w-3 animate-spin opacity-60" />}
      </div>
      <AnimatePresence mode="wait">
        {quote && "usdPerHour" in quote ? (
          <motion.div
            key={`${quote.usdPerHour}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-right"
          >
            <div className="font-mono text-sm tabular-nums">
              {formatUsdPerHour(quote.usdPerHour)} ·{" "}
              <span className="text-[var(--color-primary)]">
                {formatUsd(quote.usdPerHour * HOURS_PER_MONTH)}/mo
              </span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted">{quote.source}</div>
          </motion.div>
        ) : quote && "error" in quote ? (
          <motion.div
            key="err"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-right text-[11px] text-muted"
          >
            {quote.error}
          </motion.div>
        ) : (
          <span className="text-[11px] text-muted">…</span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
