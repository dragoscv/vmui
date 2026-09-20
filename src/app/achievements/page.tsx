import { AchievementGrid } from "@/components/achievements/achievement-grid";
import { PageHeader, PageShell, Stat, StatGrid } from "@/components/ui";
import { computeAchievements } from "@/lib/achievements";
import { Activity, Flame, Trophy } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AchievementsPage() {
  const [{ achievements, streak, totalActions }, t] = await Promise.all([computeAchievements(), getTranslations("govern.achievements")]);
  const unlocked = achievements.filter((a) => a.unlocked).length;

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Trophy />} />
      <StatGrid cols={3}>
        <Stat label={t("stats.unlocked")} value={unlocked} hint={t("stats.unlockedHint", { total: achievements.length })} tone={unlocked === achievements.length ? "success" : "default"} icon={<Trophy />} />
        <Stat label={t("stats.streak")} value={streak.current} hint={t("stats.streakHint", { days: streak.longest })} tone={streak.current > 0 ? "warning" : "default"} icon={<Flame />} />
        <Stat label={t("stats.actions")} value={totalActions} icon={<Activity />} />
      </StatGrid>
      <AchievementGrid achievements={achievements} />
    </PageShell>
  );
}
