import "server-only";
import { FleetDiffView, type FleetChangeRow, type FleetDiffData } from "@/components/cloud/fleet-diff-view";
import { Button, PageHeader, PageShell } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { captureFleetSnapshot, diffFleetSnapshots, getLatestFleetDiff, listFleetSnapshots, type FleetDiff, type FleetMember } from "@/lib/fleet-diff";
import { Camera, GitCompare } from "lucide-react";
import { getTranslations } from "next-intl/server";

async function captureAction() {
  "use server";
  await requireRole("operator");
  await captureFleetSnapshot();
}

export const dynamic = "force-dynamic";

function serializeDiff(diff: FleetDiff): FleetDiffData {
  const pick = (m: FleetMember) => ({ name: m.name, providerInstanceId: m.providerInstanceId, region: m.region });
  const changed: FleetChangeRow[] = diff.changed.flatMap((c) =>
    c.fields.map((f) => ({
      id: `${c.after.accountId}:${c.after.providerInstanceId}:${f}`,
      name: c.after.name ?? c.after.providerInstanceId,
      field: f,
      before: String((c.before as unknown as Record<string, unknown>)[f] ?? "—"),
      after: String((c.after as unknown as Record<string, unknown>)[f] ?? "—"),
    })),
  );
  return {
    beforeAt: diff.beforeAt ? diff.beforeAt.toISOString() : null,
    afterAt: diff.afterAt.toISOString(),
    added: diff.added.map(pick),
    removed: diff.removed.map(pick),
    changed,
  };
}

export default async function FleetDiffPage(props: { searchParams?: Promise<{ before?: string; after?: string }> }) {
  const t = await getTranslations("cloud.fleetDiff");
  const sp = (await props.searchParams) ?? {};
  const snaps = await listFleetSnapshots();
  const diff = sp.before && sp.after ? await diffFleetSnapshots(sp.before, sp.after) : await getLatestFleetDiff();

  return (
    <PageShell>
      <PageHeader
        icon={<GitCompare />}
        title={t("title")}
        description={t("description")}
        actions={
          <form action={captureAction}>
            <Button type="submit" variant="secondary">
              <Camera className="size-4" aria-hidden />
              {t("capture")}
            </Button>
          </form>
        }
      />
      <FleetDiffView
        snaps={snaps.map((s) => ({ id: s.id, capturedAt: s.capturedAt.toISOString(), count: s.count }))}
        before={sp.before ?? null}
        after={sp.after ?? null}
        diff={diff ? serializeDiff(diff) : null}
      />
    </PageShell>
  );
}
