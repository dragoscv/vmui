import { KeyRotationView } from "@/components/key-rotation/key-rotation-view";
import { Button, EmptyState, PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { cloudAccounts, instances, sshKeys } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function KeyRotationPage() {
  const [keys, insts, accs, t] = await Promise.all([
    db.select().from(sshKeys),
    db.select().from(instances).where(eq(instances.state, "running")),
    db.select().from(cloudAccounts),
    getTranslations("ops.keyRotation"),
  ]);
  const accLabel = new Map(accs.map((a) => [a.id, a.name]));

  const vmList = insts.map((i) => ({
    id: i.id,
    name: i.name ?? i.providerInstanceId,
    region: i.region,
    publicIp: i.publicIp,
    accountLabel: accLabel.get(i.accountId) ?? i.accountId,
  }));
  const keyList = keys.map((k) => ({ id: k.id, name: k.name, algo: k.algo, fingerprint: k.fingerprint }));

  return (
    <PageShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
        icon={<KeyRound />}
        actions={
          <Button asChild variant="secondary">
            <Link href="/settings/ssh-keys">{t("manageKeys")}</Link>
          </Button>
        }
      />
      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title={t("noKeys")}
          description={t("noKeysHint")}
          action={
            <Button asChild size="sm">
              <Link href="/settings/ssh-keys">{t("manageKeys")}</Link>
            </Button>
          }
        />
      ) : (
        <KeyRotationView keys={keyList} instances={vmList} />
      )}
    </PageShell>
  );
}
