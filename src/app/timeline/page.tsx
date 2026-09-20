import { TimeMachine } from "@/components/timeline/time-machine";
import { PageHeader, PageShell } from "@/components/ui";
import { History } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  const t = await getTranslations("observe.timeline");
  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<History />} />
      <TimeMachine />
    </PageShell>
  );
}
