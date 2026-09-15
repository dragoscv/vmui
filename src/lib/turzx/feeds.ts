import { db } from "@/lib/db";
import { instances } from "@/lib/db/schema";
import { ha } from "@/lib/home/ha-client";
import "server-only";
import type { TurzxBgSource } from "./catalog";

// External data for the desk screen. Every fetch is keyless, cached in
// memory with a TTL and degrades to null — the renderer must never wait on
// a third party. All sources are the ones dashy (E:\gh\dashy) already
// vetted for licence: APOD, Met (CC0), Art Institute (public domain),
// Wikimedia Commons POTD, BNR, CoinGecko.

const cache = new Map<string, { at: number; ttl: number; value: unknown; inflight?: Promise<unknown> }>();

/** Never blocks the poll: a cold miss waits at most `waitMs` (default 1.5 s),
 *  then returns null while the fetch finishes in the background. */
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, waitMs = 1500): Promise<T | null> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < hit.ttl) return hit.value as T;
  if (hit?.inflight) return (hit.value as T) ?? null;
  const inflight = fn()
    .then((v) => {
      cache.set(key, { at: Date.now(), ttl: ttlMs, value: v });
      return v;
    })
    .catch(() => {
      // keep stale value if any, retry after a shorter backoff
      cache.set(key, { at: Date.now(), ttl: Math.min(ttlMs, 5 * 60_000), value: hit?.value ?? null });
      return (hit?.value as T) ?? null;
    });
  cache.set(key, { at: hit?.at ?? 0, ttl: hit?.ttl ?? 0, value: hit?.value ?? null, inflight });
  if (!hit) return Promise.race([inflight, new Promise<null>((res) => setTimeout(() => res(null), waitMs))]);
  return hit.value as T; // stale-while-revalidate
}

const UA = { "User-Agent": "vmui-turzx/1.0 (desk display; https://github.com/dragoscv/vmui)" };
const get = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
};

// ---------------------------------------------------------------- BNR
export interface FxRate {
  code: string;
  rate: number;
  prev: number | null;
  history: number[]; // oldest → newest, up to 30 daily closes
}

export async function bnrRates(codes: string[]): Promise<{ date: string; rates: FxRate[] } | null> {
  return cached(`bnr:${codes.join(",")}`, 60 * 60_000, async () => {
    // www.bnr.ro answers this path with the HTML homepage; curs.bnr.ro serves the XML.
    const r = await fetch("https://curs.bnr.ro/nbrfxrates10days.xml", { headers: UA, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!r.ok) throw new Error(`bnr ${r.status}`);
    const xml = await r.text();
    // One <Cube date="..."> per day, each with <Rate currency="EUR" [multiplier="100"]>4.97</Rate>
    const days = [...xml.matchAll(/<Cube date="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Cube>/g)].map((m) => {
      const date = m[1] ?? "";
      const rates = new Map<string, number>();
      for (const rm of (m[2] ?? "").matchAll(/<Rate currency="([A-Z]{3})"(?: multiplier="(\d+)")?>([\d.]+)<\/Rate>/g)) {
        rates.set(rm[1] ?? "", Number(rm[3]) / Number(rm[2] ?? 1));
      }
      return { date, rates };
    });
    days.sort((a, b) => a.date.localeCompare(b.date));
    const last = days.at(-1);
    if (!last) throw new Error("bnr: no cubes");
    return {
      date: last.date,
      rates: codes.map((code) => ({
        code,
        rate: last.rates.get(code) ?? 0,
        prev: days.at(-2)?.rates.get(code) ?? null,
        history: days.map((d) => d.rates.get(code) ?? 0).filter(Boolean),
      })),
    };
  });
}

// ---------------------------------------------------------------- CoinGecko
export interface CoinPrice {
  id: string;
  symbol: string;
  price: number;
  change24h: number;
  sparkline: number[];
}

export async function coinPrices(ids: string[], vs: string): Promise<CoinPrice[] | null> {
  if (!ids.length) return [];
  return cached(`cg:${vs}:${ids.join(",")}`, 3 * 60_000, async () => {
    const rows = await get<Array<{ id: string; symbol: string; current_price: number; price_change_percentage_24h: number; sparkline_in_7d?: { price: number[] } }>>(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&ids=${ids.join(",")}&sparkline=true&price_change_percentage=24h`,
    );
    return rows.map((r) => {
      const sp = r.sparkline_in_7d?.price ?? [];
      return { id: r.id, symbol: r.symbol.toUpperCase(), price: r.current_price, change24h: r.price_change_percentage_24h ?? 0, sparkline: sp.slice(-24) };
    });
  });
}

// ---------------------------------------------------------------- photos
export interface Photo {
  url: string;
  title: string;
  credit: string;
  source: TurzxBgSource;
}

async function apod(): Promise<Photo[]> {
  const rows = await get<Array<{ media_type: string; url: string; hdurl?: string; title: string; copyright?: string }>>(
    "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&count=8&thumbs=true",
  );
  return rows.filter((r) => r.media_type === "image").map((r) => ({ url: r.url, title: r.title, credit: (r.copyright ?? "NASA").trim() + " · NASA APOD", source: "apod" as const }));
}

async function met(): Promise<Photo[]> {
  const search = await get<{ objectIDs: number[] | null }>("https://collectionapi.metmuseum.org/public/collection/v1/search?isHighlight=true&hasImages=true&isPublicDomain=true&q=painting");
  const ids = (search.objectIDs ?? []).sort(() => Math.random() - 0.5).slice(0, 8);
  const out: Photo[] = [];
  for (const id of ids) {
    try {
      const o = await get<{ primaryImageSmall: string; title: string; artistDisplayName: string; isPublicDomain: boolean }>(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
      if (o.isPublicDomain && o.primaryImageSmall) out.push({ url: o.primaryImageSmall, title: o.title, credit: (o.artistDisplayName || "Unknown") + " · The Met, CC0", source: "met" });
    } catch {
      // skip object
    }
  }
  return out;
}

async function artic(): Promise<Photo[]> {
  const page = 1 + Math.floor(Math.random() * 20);
  const r = await get<{ data: Array<{ image_id: string | null; title: string; artist_title: string | null; is_public_domain: boolean }>; config: { iiif_url: string } }>(
    `https://api.artic.edu/api/v1/artworks/search?query[term][is_public_domain]=true&fields=image_id,title,artist_title,is_public_domain&limit=12&page=${page}`,
  );
  return r.data
    .filter((a) => a.image_id && a.is_public_domain)
    .map((a) => ({ url: `${r.config.iiif_url}/${a.image_id}/full/843,/0/default.jpg`, title: a.title, credit: (a.artist_title ?? "Unknown") + " · Art Institute of Chicago", source: "artic" as const }));
}

async function commons(): Promise<Photo[]> {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10);
  const r = await get<{ query: { pages: Record<string, { images?: Array<{ title: string }> }> } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=images&titles=Template:Potd/${ymd}&origin=*`,
  );
  const file = Object.values(r.query.pages)[0]?.images?.find((i) => /\.(jpe?g|png)$/i.test(i.title))?.title;
  if (!file) return [];
  const info = await get<{ query: { pages: Record<string, { imageinfo?: Array<{ thumburl: string; extmetadata?: { Artist?: { value: string }; ObjectName?: { value: string } } }> }> } }>(
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1024&titles=${encodeURIComponent(file)}&origin=*`,
  );
  const ii = Object.values(info.query.pages)[0]?.imageinfo?.[0];
  if (!ii) return [];
  const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "").trim();
  return [{ url: ii.thumburl, title: strip(ii.extmetadata?.ObjectName?.value) || file.replace(/^File:/, ""), credit: (strip(ii.extmetadata?.Artist?.value) || "Wikimedia Commons") + " · Commons POTD", source: "commons" }];
}

const PHOTO_FETCHERS: Record<Exclude<TurzxBgSource, "folder">, () => Promise<Photo[]>> = { apod, met, artic, commons };

/** Pool of candidate photos from the enabled online sources; refreshed every 6 h. */
export async function photoPool(sources: TurzxBgSource[]): Promise<Photo[]> {
  const online = sources.filter((s): s is Exclude<TurzxBgSource, "folder"> => s !== "folder");
  const lists = await Promise.all(online.map((s) => cached(`photos:${s}`, 6 * 60 * 60_000, PHOTO_FETCHERS[s])));
  return lists.flatMap((l) => l ?? []);
}

// ---------------------------------------------------------------- quotes
export interface Quote {
  text: string;
  author: string;
}

const QUOTES_RO: Quote[] = [
  { text: "Nu tot ce strălucește este aur.", author: "proverb" },
  { text: "Omul sfințește locul.", author: "proverb românesc" },
  { text: "Ce ție nu-ți place, altuia nu-i face.", author: "proverb" },
  { text: "Cine se scoală de dimineață departe ajunge.", author: "proverb" },
  { text: "Graba strică treaba.", author: "proverb" },
  { text: "Apa trece, pietrele rămân.", author: "proverb" },
  { text: "Lucrul bine început e pe jumătate făcut.", author: "Aristotel" },
  { text: "Singura constantă este schimbarea.", author: "Heraclit" },
  { text: "Simplitatea este sofisticarea supremă.", author: "Leonardo da Vinci" },
  { text: "Nu ai timp: îl faci.", author: "anonim" },
  { text: "Fă azi ce alții amână pe mâine.", author: "anonim" },
  { text: "Perfecțiunea se atinge nu când nu mai e nimic de adăugat, ci când nu mai e nimic de scos.", author: "Antoine de Saint-Exupéry" },
];

export async function quoteOfTheDay(lang: "ro" | "en"): Promise<Quote | null> {
  const day = Math.floor(Date.now() / 86_400_000);
  if (lang === "ro") return QUOTES_RO[day % QUOTES_RO.length] ?? null;
  return cached(`quote:en:${day}`, 24 * 60 * 60_000, async () => {
    const r = await get<Array<{ q: string; a: string }>>("https://zenquotes.io/api/today");
    const q = r[0];
    return q ? { text: q.q, author: q.a } : { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" };
  });
}

// ---------------------------------------------------------------- HA history / calendar
export interface ClimatePoint {
  t: number;
  v: number;
}

export async function haHistory(entityId: string, hours = 24): Promise<ClimatePoint[] | null> {
  return cached(`hist:${entityId}:${hours}`, 10 * 60_000, async () => {
    const since = new Date(Date.now() - hours * 3600_000);
    const rows = (await ha.history(entityId, since))[0] ?? [];
    const pts = rows
      .map((r) => {
        const raw = r as unknown as { state?: string; s?: string; last_changed?: string; lu?: number; last_updated?: string };
        const v = Number(raw.state ?? raw.s);
        const t = raw.lu ? raw.lu * 1000 : new Date(raw.last_changed ?? raw.last_updated ?? 0).getTime();
        return { t, v };
      })
      .filter((p) => Number.isFinite(p.v) && p.t > 0);
    // downsample to ≤ 96 points (every 15 min) so the payload stays small
    const step = Math.max(1, Math.ceil(pts.length / 96));
    return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  });
}

export interface CalEvent {
  summary: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string | null;
  calendar: string;
}

export interface ForecastDay {
  t: number;
  cond: string | null;
  hi: number | null;
  lo: number | null;
  rain: number | null; // probability %, when the provider gives it
}

/** Next days from HA's weather entity. 30 min TTL: forecasts change slowly and
 *  the service call is the most expensive thing this route asks HA for. */
export async function weatherForecast(entityId: string, days = 5): Promise<ForecastDay[] | null> {
  return cached(`fc:${entityId}`, 30 * 60_000, async () => {
    const rows = await ha.forecast(entityId, "daily");
    return rows.slice(0, days).map((f) => ({
      t: new Date(f.datetime).getTime(),
      cond: f.condition ?? null,
      hi: typeof f.temperature === "number" ? f.temperature : null,
      lo: typeof f.templow === "number" ? f.templow : null,
      rain: typeof f.precipitation_probability === "number" ? f.precipitation_probability : null,
    }));
  });
}

export async function calendarEvents(entityIds: string[]): Promise<CalEvent[] | null> {
  if (!entityIds.length) return [];
  return cached(`cal:${entityIds.join(",")}`, 5 * 60_000, async () => {
    const start = new Date();
    const end = new Date(Date.now() + 7 * 86_400_000);
    const all = await Promise.all(
      entityIds.map(async (id) => {
        try {
          const evs = await ha.calendarEvents(id, start, end);
          return evs.map((e) => ({
            summary: e.summary,
            start: new Date(e.start.dateTime ?? e.start.date ?? 0).getTime(),
            end: new Date(e.end.dateTime ?? e.end.date ?? 0).getTime(),
            allDay: !e.start.dateTime,
            location: e.location ?? null,
            calendar: id.replace(/^calendar\./, ""),
          }));
        } catch {
          return [];
        }
      }),
    );
    return all.flat().sort((a, b) => a.start - b.start).slice(0, 8);
  });
}

// ---------------------------------------------------------------- vmui fleet
export async function fleet() {
  const rows = await db.select({ id: instances.id, name: instances.name, displayName: instances.displayName, provider: instances.provider, state: instances.state, platform: instances.platform, type: instances.instanceType, pinned: instances.pinned }).from(instances);
  return rows
    .map((r) => ({ id: r.id, name: r.displayName ?? r.name ?? r.id, provider: r.provider, state: r.state, platform: r.platform, type: r.type, pinned: r.pinned }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.state === "running" ? -1 : 1) - (b.state === "running" ? -1 : 1) || a.name.localeCompare(b.name));
}
