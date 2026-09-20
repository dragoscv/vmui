"use client";

import { ProviderTile, useProviderLabel } from "@/components/cloud/provider-tile";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { AwsAccountConnect } from "./aws-account-connect";
import { AzureAccountConnect } from "./azure-account-connect";
import { DigitalOceanAccountConnect } from "./digitalocean-account-connect";
import { GcpAccountConnect } from "./gcp-account-connect";
import { HetznerAccountConnect } from "./hetzner-account-connect";
import { LocalKvmAccountConnect } from "./local-kvm-account-connect";
import { ScalewayAccountConnect } from "./scaleway-account-connect";

const PROVIDERS = ["aws", "azure", "gcp", "digitalocean", "hetzner", "scaleway", "local-kvm"] as const;
type Provider = (typeof PROVIDERS)[number];

const CONNECT: Record<Provider, React.ComponentType> = {
  aws: AwsAccountConnect,
  azure: AzureAccountConnect,
  gcp: GcpAccountConnect,
  digitalocean: DigitalOceanAccountConnect,
  hetzner: HetznerAccountConnect,
  scaleway: ScalewayAccountConnect,
  "local-kvm": LocalKvmAccountConnect,
};

export function ProviderPicker({ initial = "aws" }: { initial?: Provider }) {
  const t = useTranslations("cloud.accountNew");
  const label = useProviderLabel();
  const [selected, setSelected] = useState<Provider>(initial);
  const refs = useRef<Map<Provider, HTMLButtonElement>>(new Map());

  const move = (from: number, dir: 1 | -1) => {
    const next = PROVIDERS[(from + dir + PROVIDERS.length) % PROVIDERS.length];
    if (!next) return;
    setSelected(next);
    refs.current.get(next)?.focus();
  };

  const Connect = CONNECT[selected];

  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label={t("pickerLabel")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PROVIDERS.map((p, i) => {
          const on = p === selected;
          return (
            <button
              key={p}
              ref={(el) => {
                if (el) refs.current.set(p, el);
                else refs.current.delete(p);
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => setSelected(p)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={cn(
                "flex min-h-20 items-center gap-3 rounded-[var(--radius-lg)] border p-3 text-left transition-[border-color,background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                on
                  ? "border-primary bg-[color-mix(in_oklch,var(--color-primary)_10%,transparent)] shadow-[var(--shadow-sm)]"
                  : "surface card-hover border-border",
              )}
            >
              <ProviderTile provider={p} size="lg" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{label(p)}</span>
                <span className="block text-xs leading-snug text-muted">{t(`providers.${p}`)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div key={selected}>
        <Connect />
      </div>
    </div>
  );
}
