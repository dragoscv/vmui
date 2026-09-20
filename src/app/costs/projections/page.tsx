import "server-only";
import { ProjectionChart } from "@/components/costs/projection-chart";
import { Badge, Button, EmptyState, PageHeader, PageSection, PageShell, Stat, StatGrid } from "@/components/ui";
import { formatUsd } from "@/lib/utils";
import { computeProjections } from "@/server/queries/projections";
import { ChevronRight, TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProjectionsPage() {
  const [t, p] = await Promise.all([getTranslations("cloud.projections"), computeProjections(30)]);

  return (
    <PageShell>
      <PageHeader
        icon={<TrendingUp />}
        title={t("title")}
        description={t("description")}
        breadcrumbs={
          <nav aria-label={t("breadcrumbLabel")} className="flex items-center gap-1">
            <Link href="/costs" className="hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {t("breadcrumb")}
            </Link>
            <ChevronRight className="size-3" aria-hidden />
            <span aria-current="page">{t("title")}</span>
          </nav>
        }
      />

      {!p ? (
        <EmptyState
          icon={<TrendingUp />}
          title={t("empty.title")}
          description={t("empty.description")}
          action={
            <Button asChild variant="outline">
              <Link href="/costs">{t("empty.action")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <StatGrid cols={3}>
            {p.bands.map((b) => (
              <Stat
                key={b.daysAhead}
                label={t("band.label", { days: b.daysAhead })}
                value={t("perMonth", { amount: formatUsd(b.monthlyUsd) })}
                hint={
                  <>
                    {t("band.ci", { lo: formatUsd(b.monthlyLo), hi: formatUsd(b.monthlyHi) })} · {t("band.hourly", { amount: formatUsd(b.hourlyUsd) })}
                  </>
                }
              />
            ))}
          </StatGrid>

          <PageSection
            title={t("chart.title")}
            description={t("chart.description")}
            action={
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="muted">
                  {t("facts.slope")}: <span className="tabular-nums text-fg">{t("facts.slopeValue", { amount: formatUsd(p.slopeUsdPerDay) })}</span>
                </Badge>
                <Badge variant="muted">
                  {t("facts.points")}: <span className="tabular-nums text-fg">{p.pointsUsed}</span>
                </Badge>
                <Badge variant="muted">
                  {t("facts.sigma")}: <span className="tabular-nums text-fg">{t("facts.sigmaValue", { amount: formatUsd(p.sigma) })}</span>
                </Badge>
              </div>
            }
          >
            <ProjectionChart history={p.history} bands={p.bands} sigma={p.sigma} slopeUsdPerDay={p.slopeUsdPerDay} currentHourlyUsd={p.currentHourlyUsd} />
          </PageSection>
        </>
      )}
    </PageShell>
  );
}
