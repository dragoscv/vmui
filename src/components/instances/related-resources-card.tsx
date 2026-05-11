import "server-only";
import { Link as LinkIcon, HardDrive, Camera, Shield, KeyRound, Globe, Database } from "lucide-react";
import Link from "next/link";
import { and, eq, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { cachedResources } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
    <Card className="surface">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <LinkIcon className="h-4 w-4 text-[var(--color-primary)]" />
          Related resources
          <Badge variant="muted" className="text-[10px]">
            {rows.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {[...groups.entries()].map(([kind, items]) => {
            const Icon = KIND_ICON[kind] ?? HardDrive;
            return (
              <div key={kind} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <Icon className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                  {kind}
                  <span className="ml-auto font-mono text-[10px] opacity-70">{items.length}</span>
                </div>
                <ul className="space-y-1">
                  {items.slice(0, 6).map((r) => (
                    <li key={r.id} className="truncate text-xs">
                      <Link
                        href={`/resources?q=${encodeURIComponent(r.externalId)}`}
                        className="hover:text-[var(--color-primary)] hover:underline"
                        title={r.externalId}
                      >
                        {r.name ?? r.externalId}
                      </Link>
                    </li>
                  ))}
                  {items.length > 6 && (
                    <li className="text-[11px] text-muted">+ {items.length - 6} more</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
