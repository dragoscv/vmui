import { TeamsWorkspace } from "@/components/teams/teams-workspace";
import { PageHeader, PageShell } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { listTeamsForUser } from "@/lib/teams";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslations("govern.teams")]);
  const teams = user ? await listTeamsForUser(user.id) : [];
  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<Users />} />
      <TeamsWorkspace teams={teams} />
    </PageShell>
  );
}
