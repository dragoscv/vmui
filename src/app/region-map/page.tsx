import "server-only";
import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";

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
  const all = await db.select().from(instances);
  const counts = new Map<string, number>();
  for (const i of all) {
    const b = bucketFor(i.region);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const max = Math.max(1, ...[...counts.values()]);

  const W = 900, H = 460;
  const proj = (lat: number, lng: number) => ({
    x: (lng + 180) * (W / 360),
    y: (90 - lat) * (H / 180),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Region heatmap</h1>
        <p className="text-sm text-zinc-400">
          VM count per geographic bucket. Bucket labels are an approximation grouping the providers&rsquo; native regions.
        </p>
      </header>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 overflow-x-auto">
        <svg width={W} height={H} className="block mx-auto" viewBox={`0 0 ${W} ${H}`}>
          <rect width={W} height={H} fill="rgb(9 9 11)" />
          <g stroke="rgb(63 63 70)" strokeWidth="0.5" fill="none">
            {Array.from({ length: 7 }, (_, i) => (
              <line key={`h${i}`} x1={0} y1={(H / 6) * i} x2={W} y2={(H / 6) * i} />
            ))}
            {Array.from({ length: 13 }, (_, i) => (
              <line key={`v${i}`} x1={(W / 12) * i} y1={0} x2={(W / 12) * i} y2={H} />
            ))}
          </g>
          {GEO_BUCKETS.map((b) => {
            const n = counts.get(b.label) ?? 0;
            const r = 8 + Math.sqrt(n / max) * 36;
            const { x, y } = proj(b.lat, b.lng);
            return (
              <g key={b.label}>
                <circle cx={x} cy={y} r={r} fill="rgb(52 211 153 / 0.25)" stroke="rgb(52 211 153)" strokeWidth={1.5} />
                <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill="rgb(244 244 245)" fontWeight={600}>{n}</text>
                <text x={x} y={y + r + 12} textAnchor="middle" fontSize={9} fill="rgb(161 161 170)">{b.label}</text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => (
          <div key={k} className="flex justify-between rounded border border-zinc-800 bg-zinc-950 p-2"><span>{k}</span><span className="font-mono">{v}</span></div>
        ))}
      </div>
    </div>
  );
}
