import { Badge, PageSection } from "@/components/ui";
import { db } from "@/lib/db";
import { cachedResources } from "@/lib/db/schema";
import { and, eq, like, or } from "drizzle-orm";
import { Camera, Database, Globe, HardDrive, KeyRound, Shield } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import "server-only";

const KIND_ICON: Record<string, typeof HardDrive> = {
  volume: HardDrive,
  disk: HardDrive,
  snapshot: Camera,
  "security-group": Shield,
  nsg: Shield,
  firewall: Shield,
  keypair: KeyRound,
  bucket: Database,
  "load-balancer": Globe,
};

const KIND_KEYS = [
  "volume",
  "disk",
  "snapshot",
  "security-group",
  "nsg",
  "firewall",
  "keypair",
  "bucket",
  "load-balancer",
  "vpc",
  "subnet",
  "network",
  "image",
  "db",
  "dns",
] as const;
type KindKey = (typeof KIND_KEYS)[number];
const isKindKey = (k: string): k is KindKey => (KIND_KEYS as readonly string[]).includes(k);

interface Props {
  accountId: string;
  region: string;
  providerInstanceId: string;
}

/**
 * Lightweight dependency view: every cached resource that mentions this
 * instance via `attachedToInstanceId`, name, or external id. Click-through
 * goes to the resources page filtered to the matching record.
 */
export async function RelatedResourcesCard({ accountId, region, providerInstanceId }: Props) {
  const t = await getTranslations("vm.resources");
  const idFragment = `%${providerInstanceId}%`;
  const rows = await db
    .select()
    .from(cachedResources)
    .where(
      and(
        eq(cachedResources.accountId, accountId),
        eq(cachedResources.region, region),
        or(
          eq(cachedResources.attachedToInstanceId, providerInstanceId),
          like(cachedResources.name, idFragment),
          like(cachedResources.externalId, idFragment),
        ),
      ),
    );

  if (rows.length === 0) return null;

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = groups.get(r.kind) ?? [];
    arr.push(r);
    groups.set(r.kind, arr);
  }

  return (
    <PageSection
      title={
        <span className="inline-flex items-center gap-2">
          {t("title")}
          <Badge variant="muted" className="text-[10px]">
            {rows.length}
          </Badge>
        </span>
      }
      description={t("description")}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {[...groups.entries()].map(([kind, items]) => {
          const Icon = KIND_ICON[kind] ?? HardDrive;
          return (
            <div key={kind} className="rounded-[var(--radius-md)] border border-border p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                {isKindKey(kind) ? t(`kinds.${kind}`) : kind}
                <span className="ml-auto font-mono text-[10px] opacity-70">{items.length}</span>
              </div>
              <ul className="space-y-1">
                {items.slice(0, 6).map((r) => (
                  <li key={r.id} className="min-w-0 truncate text-xs">
                    <Link
                      href={`/resources?q=${encodeURIComponent(r.externalId)}`}
                      className="rounded-[var(--radius-sm)] hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      title={r.externalId}
                    >
                      {r.name ?? r.externalId}
                    </Link>
                  </li>
                ))}
                {items.length > 6 && <li className="text-[11px] text-muted">{t("more", { count: items.length - 6 })}</li>}
              </ul>
            </div>
          );
        })}
      </div>
    </PageSection>
  );
}
