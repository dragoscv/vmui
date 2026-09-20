"use client";

import { useTranslations } from "next-intl";

export function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

type LooseTranslator = { (key: string): string; has(key: string): boolean };

/** Kind labels are an open set (providers add new ones); unknown kinds fall back to the raw value. */
export function useKindLabel(): (kind: string) => string {
  const t = useTranslations("cloud.resources.kinds") as unknown as LooseTranslator;
  return (kind) => (t.has(kind) ? t(kind) : kind);
}
