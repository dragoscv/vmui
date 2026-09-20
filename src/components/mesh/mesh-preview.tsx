"use client";

import { Badge } from "@/components/ui";
import { useTranslations } from "next-intl";
import { useThemeTokens } from "@/components/topology/theme-colors";

export interface PreviewPeer {
  id: string;
  label: string;
  publicIp: string | null;
  selected: boolean;
}

/** Ring layout of peers with a full-mesh edge set for the selected ones. Colours are theme tokens read at runtime. */
export function MeshPreview({ peers }: { peers: PreviewPeer[] }) {
  const t = useTranslations("ops.mesh");
  const c = useThemeTokens(["primary", "accent", "border", "fg-muted", "fg", "surface"]);
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 36;
  const points = peers.map((p, i) => {
    const a = (i / Math.max(1, peers.length)) * Math.PI * 2 - Math.PI / 2;
    return { ...p, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  const selected = points.filter((p) => p.selected);

  return (
    <div className="space-y-3">
      <div className="hidden md:block">
        <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-auto w-full max-w-xs" role="img" aria-label={t("preview.aria", { count: selected.length })}>
          {selected.map((a, i) =>
            selected.slice(i + 1).map((b) => (
              <line key={`${a.id}-${b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c.primary} strokeOpacity={0.55} strokeWidth={1.5} />
            )),
          )}
          {points.map((p) => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r={p.selected ? 9 : 6} fill={p.selected ? (p.publicIp ? c.primary : c.accent) : c.surface} stroke={p.selected ? "none" : c.border} strokeWidth={1.5} />
              <text x={p.x} y={p.y + (p.y > cy ? 22 : -14)} textAnchor="middle" fontSize="10" fill={p.selected ? c.fg : c["fg-muted"]} className="font-mono">
                {p.label.slice(0, 16)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <ul className="space-y-1 md:hidden" aria-label={t("preview.listAria")}>
        {points.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm">
            <span className="truncate font-mono text-xs">{p.label}</span>
            <Badge variant={p.selected ? (p.publicIp ? "info" : "warning") : "muted"}>{p.selected ? (p.publicIp ? t("legend.public") : t("legend.private")) : t("legend.excluded")}</Badge>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5" aria-label={t("legend.title")}>
        <Badge variant="info" dot>
          {t("legend.public")}
        </Badge>
        <Badge variant="warning" dot>
          {t("legend.private")}
        </Badge>
        <Badge variant="muted">{t("legend.excluded")}</Badge>
        <Badge variant="default">{t("legend.edges", { count: (selected.length * (selected.length - 1)) / 2 })}</Badge>
      </div>
    </div>
  );
}
