import { Badge, PageSection, Progress, Stat, StatGrid, type ProgressTone } from "@/components/ui";
import type { TagGovernanceSummary } from "@/server/queries/tag-governance";
import { AlertTriangle, CheckCircle2, Server, Tag as TagIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { TagChip } from "./tag-chip";

export async function TagGovernancePanel({ data }: { data: TagGovernanceSummary }) {
  const t = await getTranslations("govern.tags");
  const taggedPct = data.totalInstances === 0 ? 100 : Math.round((data.taggedInstances / data.totalInstances) * 100);
  const maxKey = data.perKey[0]?.instances ?? 1;

  return (
    <div className="space-y-4">
      <StatGrid cols={3}>
        <Stat label={t("stats.instances")} value={data.totalInstances} icon={<Server />} />
        <Stat label={t("stats.tagged")} value={data.taggedInstances} hint={t("stats.taggedHint", { pct: taggedPct })} icon={<TagIcon />} tone={taggedPct === 100 ? "success" : "default"} />
        <Stat label={t("stats.untagged")} value={data.untaggedInstances} tone={data.untaggedInstances > 0 ? "warning" : "success"} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <PageSection title={t("keys.title")} description={t("keys.description")}>
          {data.perKey.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("keys.empty")}</p>
          ) : (
            <ul className="space-y-3">
              {data.perKey.slice(0, 10).map((k) => (
                <li key={k.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <TagChip tagKey={k.key} />
                    <span className="shrink-0 text-fg-muted">{t("keys.usage", { instances: k.instances, values: k.uniqueValues })}</span>
                  </div>
                  <Progress size="sm" value={k.instances} max={maxKey} />
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        <PageSection title={t("coverage.title")} description={t("coverage.description")}>
          {data.accountCoverage.length === 0 ? (
            <p className="text-sm text-fg-muted">{t("coverage.empty")}</p>
          ) : (
            <ul className="space-y-4">
              {data.accountCoverage.map((a) => {
                const noReq = a.requiredKeys.length === 0;
                const Icon = a.coveragePct >= 100 ? CheckCircle2 : AlertTriangle;
                const tone: ProgressTone = a.coveragePct >= 100 ? "success" : a.coveragePct >= 50 ? "warning" : "danger";
                const textTone = a.coveragePct >= 100 ? "text-success" : a.coveragePct >= 50 ? "text-warning" : "text-danger";
                return (
                  <li key={a.accountId} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{a.accountName}</span>
                        <Badge variant="muted">{a.provider}</Badge>
                      </span>
                      {!noReq && (
                        <span className={`inline-flex shrink-0 items-center gap-1 tabular-nums ${textTone}`}>
                          <Icon className="size-3.5" aria-hidden /> {a.coveragePct}%
                        </span>
                      )}
                    </div>
                    {noReq ? (
                      <p className="text-xs text-fg-muted">{t("coverage.noRequired")}</p>
                    ) : (
                      <>
                        <Progress size="sm" tone={tone} value={a.coveragePct} />
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                          <span>{t("coverage.compliant", { compliant: a.fullyCompliant, total: a.totalInstances })}</span>
                          <span aria-hidden>·</span>
                          <span>{t("coverage.requires")}</span>
                          {a.requiredKeys.map((k) => (
                            <TagChip key={k} tagKey={k} />
                          ))}
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </PageSection>
      </div>
    </div>
  );
}
