"use client";

import { cn } from "@/lib/utils";
import { Apple, Boxes, Cloud, Droplets, MonitorCog, Server } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as React from "react";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  aws: Cloud,
  azure: Cloud,
  gcp: Cloud,
  scaleway: Apple,
  digitalocean: Droplets,
  hetzner: Server,
  "local-kvm": MonitorCog,
};

const LABEL_KEY = {
  aws: "provider.aws",
  azure: "provider.azure",
  gcp: "provider.gcp",
  scaleway: "provider.scaleway",
  digitalocean: "provider.digitalocean",
  hetzner: "provider.hetzner",
  "local-kvm": "provider.local-kvm",
} as const;

const ACCENT: Record<string, string> = {
  aws: "var(--color-warning)",
  azure: "var(--color-info)",
  gcp: "var(--color-success)",
  scaleway: "var(--color-accent)",
  digitalocean: "var(--color-info)",
  hetzner: "var(--color-danger)",
  "local-kvm": "var(--color-primary)",
};

export function useProviderLabel(): (provider: string) => string {
  const t = useTranslations("cloud.shared");
  return (provider: string) => t(LABEL_KEY[provider as keyof typeof LABEL_KEY] ?? "provider.unknown");
}

const SIZES = {
  sm: "size-7 [&>svg]:size-3.5",
  md: "size-9 [&>svg]:size-4",
  lg: "size-12 [&>svg]:size-6",
} as const;

/** Provider logo tile — token-tinted, label comes from the shared `cloud.shared.provider.*` keys. */
export function ProviderTile({
  provider,
  size = "md",
  className,
}: {
  provider: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const label = useProviderLabel()(provider);
  const Icon = ICON[provider] ?? Boxes;
  const accent = ACCENT[provider] ?? "var(--color-primary)";
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("grid shrink-0 place-items-center rounded-[var(--radius-md)]", SIZES[size], className)}
      style={{ background: `color-mix(in oklch, ${accent} 16%, transparent)`, color: accent }}
    >
      <Icon aria-hidden />
    </span>
  );
}

export function ProviderName({ provider, className }: { provider: string; className?: string }) {
  return <span className={className}>{useProviderLabel()(provider)}</span>;
}
