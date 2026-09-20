import "server-only";
import { REGION_MAP_HEIGHT, REGION_MAP_WIDTH, RegionMap } from "@/components/cloud/region-map";
import { EmptyState, PageHeader, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { Globe } from "lucide-react";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

const GEO_BUCKETS: { label: string; lat: number; lng: number; matches: RegExp }[] = [
  { label: "us-east",     lat: 39, lng: -77,  matches: /^us-east|^eastus|^us-central1|^us-east|^nyc|^ny\d|^iad|^bos|^was|^atl|^ord/i },
  { label: "us-west",     lat: 37, lng: -122, matches: /^us-west|^westus|^us-west\d|^us-central|^sfo|^sea|^lax|^pdx|^las/i },
  { label: "ca",          lat: 45, lng: -75,  matches: /^ca-|^canadacentral|^canada|^yul|^yyz/i },
  { label: "sa",          lat: -23, lng: -46, matches: /^sa-|^brazil|^southamer|^gru/i },
  { label: "eu-west",     lat: 51, lng: 0,    matches: /^eu-west|^westeurope|^uksouth|^ukwest|^lon|^lhr|^ams|^dub|^par|^cdg|^waw|^fra/i },
  { label: "eu-central",  lat: 50, lng: 9,    matches: /^eu-central|^germanywest|^centraleurope|^fsn|^nbg|^helsinki|^stockholm|^arn/i },
  { label: "eu-south",    lat: 41, lng: 12,   matches: /^eu-south|^italynorth|^mil|^mad/i },
  { label: "me",          lat: 25, lng: 55,   matches: /^me-|^uaenorth|^bahrain|^dubai/i },
  { label: "af",          lat: -33, lng: 18,  matches: /^af-|^southafrica|^johannesburg|^cpt/i },
  { label: "ap-northeast",lat: 35, lng: 139,  matches: /^ap-northeast|^japaneast|^korea|^tokyo|^osaka|^seoul|^nrt|^hnd/i },
  { label: "ap-southeast",lat: 1,  lng: 103,  matches: /^ap-southeast|^southeastasia|^australia|^syd|^mel|^sin|^sgp|^kul/i },
  { label: "ap-south",    lat: 19, lng: 73,   matches: /^ap-south|^centralindia|^southindia|^mumbai|^bom|^maa|^blr/i },
  { label: "cn",          lat: 31, lng: 121,  matches: /^cn-|^china|^beijing|^shanghai/i },
];

function bucketFor(region: string): string {
  for (const b of GEO_BUCKETS) if (b.matches.test(region)) return b.label;
  return "other";
}

export default async function RegionMapPage() {
  const t = await getTranslations("cloud.regionMap");
  const all = await db.select().from(instances);
  const counts = new Map<string, number>();
  for (const i of all) {
    const b = bucketFor(i.region);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const max = Math.max(1, ...[...counts.values()]);

  const proj = (lat: number, lng: number) => ({
    x: (lng + 180) * (REGION_MAP_WIDTH / 360),
    y: (90 - lat) * (REGION_MAP_HEIGHT / 180),
  });
  const points = GEO_BUCKETS.map((b) => ({ label: b.label, ...proj(b.lat, b.lng), n: counts.get(b.label) ?? 0 }));
  const sortedCounts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => ({ label: label === "other" ? t("other") : label, n }));

  return (
    <PageShell>
      <PageHeader icon={<Globe />} title={t("title")} description={t("description")} />
      {all.length === 0 ? (
        <EmptyState icon={<Globe />} title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <RegionMap
          points={points}
          max={max}
          counts={sortedCounts}
          ariaLabel={t("mapAria", { count: all.length, buckets: counts.size })}
        />
      )}
    </PageShell>
  );
}
