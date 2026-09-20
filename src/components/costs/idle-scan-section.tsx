import "server-only";
import { Badge, PageSection } from "@/components/ui";
import { findIdleAwsInstances } from "@/server/actions/idle-scan";
import { getTranslations } from "next-intl/server";
import { IdleHintList } from "./idle-hint-list";

export async function IdleScanSection() {
  let hints: Awaited<ReturnType<typeof findIdleAwsInstances>> = [];
  try {
    hints = await findIdleAwsInstances();
  } catch {
    hints = [];
  }
  if (hints.length === 0) return null;
  const t = await getTranslations("cloud.costs.idle");
  return (
    <PageSection title={t("title")} description={t("description")} action={<Badge variant="warning">{t("flagged", { count: hints.length })}</Badge>}>
      <IdleHintList hints={hints} />
    </PageSection>
  );
}
