"use client";

import type { DisplaySettings, DisplayViewId } from "@/lib/display/settings-meta";
import * as React from "react";

/* ------------------------------------------------------------------ types */
type Ent = { state: string; attributes: Record<string, unknown> };
type Photo = { url: string; title?: string | null; credit?: string | null; source?: string };
type Media = { id: string; name: string | null; state: string; title: string | null; artist: string | null; app: string | null; art: string | null; position: number | null; duration: number | null; positionAt: string | null };
type Device = { id: string; name: string; kind: string; entity?: string; entities?: string[]; room: string; whiteOnly?: boolean; via: string };
type Room = { id: string; name: string };
type State = {
  now: number;
  haOnline?: boolean;
  haUrl: string | null;
  display: DisplaySettings;
  rooms: Room[];
  devices: Device[];
  entities: Record<string, Ent>;
  photos?: Photo[];
  weather?: Ent | null;
  forecast?: Array<{ t: number; cond: string; hi: number; lo: number }>;
  hourly?: Array<{ t: number; temp: number; cond: string }>;
  inside?: { temp?: Ent | null; hum?: Ent | null } | null;
  home?: { door?: Ent; presence?: Ent; lightsOn?: number; lightsTotal?: number } | null;
  media?: Media[];
  calendar?: Array<{ title: string; start: number | string; allDay?: boolean }>;
  fx?: { date: string; rates: Array<{ code: string; rate: number; prev: number }> } | null;
  crypto?: Array<{ symbol: string; price: number; change24h: number }> | null;
  nutrition?: { targets: { calories: number; protein: number; carbs: number; fats: number }; today: { calories: number; protein: number; carbs: number; fats: number; meals: number }; water: { ml: number; glasses: number; targetMl: number; underPace: boolean } } | null;
  pcs?: Record<string, Record<string, unknown>>;
  pi?: Record<string, unknown> | null;
  batteries?: Array<{ name: string; pct: number }>;
  ambilight?: { hyper?: Ent } | null;
  hubIdle?: boolean;
  build?: string;
};

const COND: Record<string, string> = { sunny: "☀", "clear-night": "☾", partlycloudy: "⛅", cloudy: "☁", rainy: "🌧", pouring: "🌧", snowy: "🌨", fog: "🌫", lightning: "⛈", "lightning-rainy": "⛈", windy: "💨" };
const COND_RO: Record<string, string> = { sunny: "senin", "clear-night": "senin", partlycloudy: "parțial noros", cloudy: "noros", rainy: "ploaie", pouring: "ploaie torențială", snowy: "ninsoare", fog: "ceață", lightning: "furtună", "lightning-rainy": "furtună", windy: "vânt" };
const DAYS = ["duminică", "luni", "marți", "miercuri", "joi", "vineri", "sâmbătă"];
const MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const ROOM_RO: Record<string, string> = { bedroom: "Dormitor", living_room: "Sufragerie", kitchen: "Bucătărie", office: "Birou" };

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const pct = (v: unknown) => Math.max(0, Math.min(1, num(v) / 100));
const hhmm = (t: number) => new Date(t).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });

function inNight(s: DisplaySettings, now: Date): boolean {
  const [fh, fm] = s.nightFrom.split(":").map(Number);
  const [th, tm] = s.nightTo.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const from = (fh ?? 23) * 60 + (fm ?? 0);
  const to = (th ?? 7) * 60 + (tm ?? 0);
  return from > to ? cur >= from || cur < to : cur >= from && cur < to;
}

/* ------------------------------------------------------------------ root */
export function Kiosk({ token }: { token: string }) {
  const [st, setSt] = React.useState<State | null>(null);
  const [online, setOnline] = React.useState(true);
  const [mode, setMode] = React.useState<"idle" | "home">("idle");
  React.useEffect(() => {
    if (!new URLSearchParams(location.search).has("home")) return;
    setMode("home"); // debug: hold the home screen for a perf sample
    const id = setInterval(() => (lastTouch.current = Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const [tick, setTick] = React.useState(() => Date.now());
  const lastTouch = React.useRef(Date.now());
  const idleFlag = React.useRef<boolean | null>(null);
  const buildRef = React.useRef<string | null>(null);

  const api = React.useCallback(
    (path: string, init?: RequestInit) => fetch(`/api/display/${path}?k=${encodeURIComponent(token)}`, { cache: "no-store", ...init }),
    [token],
  );

  // ?perf=1 — 60 s of rAF fps + long tasks + memory, posted once to /api/display/probe (audit_log)
  React.useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("perf")) return;
    const frames: number[] = [];
    let last = performance.now();
    let raf = 0;
    const tickFrame = (t: number) => {
      frames.push(t - last);
      last = t;
      raf = requestAnimationFrame(tickFrame);
    };
    raf = requestAnimationFrame(tickFrame);
    const long: number[] = [];
    const longAt: number[] = [];
    const t0 = performance.now();
    let po: PerformanceObserver | undefined;
    try {
      po = new PerformanceObserver((l) => l.getEntries().forEach((e) => { long.push(Math.round(e.duration)); longAt.push(Math.round((e.startTime - t0) / 1000)); }));
      po.observe({ type: "longtask", buffered: true });
    } catch { /* not supported */ }
    const done = setTimeout(() => {
      cancelAnimationFrame(raf);
      po?.disconnect();
      const sorted = [...frames].sort((a, b) => a - b);
      const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      const avg = frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length);
      // frames per second, one bucket per second — shows whether 44 fps is a steady rate or 60 with holes
      const perSec: number[] = [];
      let acc = 0, sec = 0;
      for (const f of frames) { acc += f; if (acc >= 1000) { perSec.push(sec + 1); acc -= 1000; sec = 0; } else sec++; }
      const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      void api("probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
          body: JSON.stringify({ perf: true, hub: navigator.userAgent.includes("CrKey"), q: location.search, mode: document.querySelector(".dk")?.className ?? mode, secs: 60, frames: frames.length, fps: Math.round(1000 / avg), p50ms: Math.round(p(0.5)), p95ms: Math.round(p(0.95)), maxMs: Math.round(sorted.at(-1) ?? 0), dropped: frames.filter((f) => f > 34).length, longTasks: long, longAt, perSec, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null }),
      });
    }, 60000);
    return () => {
      cancelAnimationFrame(raf);
      po?.disconnect();
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one 60 s sample per load
  }, [api]);

  // poll: 3 s, 10 s in the night window, 2 s while music plays (position bar)
  React.useEffect(() => {
    let alive = true;
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const loop = async () => {
      let wait = 3000;
      try {
        const r = await api("state");
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as State;
        if (!alive) return;
        // new server build -> pick up the new page (DashCast never reloads on its own)
        if (j.build && buildRef.current && j.build !== buildRef.current) location.reload();
        buildRef.current = j.build ?? buildRef.current;
        setSt(j);
        setOnline(true);
        const playing = (j.media ?? []).some((m) => m.state === "playing");
        wait = playing ? 2000 : inNight(j.display, new Date()) ? 10000 : 3000;
        // the Hub's own touch is only visible to us through HA (input_boolean.nest_hub_idle)
        if (j.hubIdle === false && idleFlag.current !== false) {
          lastTouch.current = Date.now();
          setMode("home");
        }
        idleFlag.current = j.hubIdle ?? null;
      } catch {
        if (alive) setOnline(false);
        wait = 5000;
      }
      if (alive) timer = setTimeout(loop, wait);
    };
    void loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [api]);

  // 1 s clock, also drives the idle timeout
  React.useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTick(now);
      if (mode === "home" && st && now - lastTouch.current > st.display.idleAfterSec * 1000) {
        setMode("idle");
        void api("control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "idle", on: true }) }).catch(() => undefined);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [mode, st, api]);

  const wake = React.useCallback(() => {
    lastTouch.current = Date.now();
    if (mode !== "home") {
      const go = () => setMode("home");
      const d = document as Document & { startViewTransition?: (cb: () => void) => void };
      if (d.startViewTransition) d.startViewTransition(go);
      else go();
      void api("control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "idle", on: false }) }).catch(() => undefined);
    }
  }, [mode, api]);

  const s = st?.display;
  const night = s ? inNight(s, new Date(tick)) : false;
  const style = { "--accent": s?.accent ?? "#f2b85a", "--dim": String(s?.dim ?? 0.35), "--night": String(night ? (s?.nightDim ?? 0.35) : 1) } as React.CSSProperties;

  if (!st) {
    return (
      <div className="dk" style={style}>
        <div className="dk-flat" />
        <div className="chip off"><i />{online ? "se încarcă…" : "vmui offline"}</div>
      </div>
    );
  }

  return (
    <div className={`dk ${mode}`} style={style} onPointerDown={wake}>
      <Idle st={st} tick={tick} api={api} active={mode === "idle"} />
      {mode === "home" && <Home st={st} tick={tick} api={api} onTouch={() => (lastTouch.current = Date.now())} />}
      <div className="dk-night" />
      {!online && <div className="chip off"><i />vmui offline</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ idle rotation */
function Idle({ st, tick, api, active }: { st: State; tick: number; api: (p: string, i?: RequestInit) => Promise<Response>; active: boolean }) {
  const views = React.useMemo(() => {
    const enabled = st.display.views.filter((v) => v.enabled);
    const playing = (st.media ?? []).some((m) => m.state === "playing");
    return enabled.filter((v) => {
      if (v.id === "media") return playing;
      if (v.id === "pc") return Object.keys(st.pcs ?? {}).length > 0;
      if (v.id === "pi") return !!st.pi;
      if (v.id === "photo") return (st.photos?.length ?? 0) > 0;
      if (v.id === "calendar") return (st.calendar?.length ?? 0) > 0;
      if (v.id === "fx") return !!st.fx;
      if (v.id === "crypto") return (st.crypto?.length ?? 0) > 0;
      if (v.id === "nutrition") return !!st.nutrition;
      return true;
    });
  }, [st]);

  const [idx, setIdx] = React.useState(0);
  const [prev, setPrev] = React.useState<DisplayViewId | null>(null);
  const since = React.useRef(Date.now());
  const cur = views[idx % Math.max(1, views.length)] ?? views[0];

  // music starting jumps straight to the media view
  const playingRef = React.useRef(false);
  React.useEffect(() => {
    const playing = (st.media ?? []).some((m) => m.state === "playing");
    if (playing && !playingRef.current) {
      const i = views.findIndex((v) => v.id === "media");
      if (i >= 0) {
        setPrev(cur?.id ?? null);
        setIdx(i);
        since.current = Date.now();
      }
    }
    playingRef.current = playing;
  }, [st.media, views, cur]);

  React.useEffect(() => {
    if (!active || !cur) return;
    if (tick - since.current >= cur.dwellSec * 1000 && views.length > 1) {
      setPrev(cur.id);
      setIdx((i) => (i + 1) % views.length);
      since.current = tick;
      const t = setTimeout(() => setPrev(null), 400);
      return () => clearTimeout(t);
    }
  }, [tick, active, cur, views.length]);

  const wantPhoto = cur ? cur.photo || cur.id === "photo" : true;
  const photos = st.photos ?? [];
  // the photo actually on screen, reported by PhotoLayer once it has decoded — the caption follows it
  const [shown, setShown] = React.useState<Photo | undefined>(undefined);
  const media = (st.media ?? []).find((m) => m.state === "playing") ?? st.media?.[0] ?? null;
  const art = media?.art ? (media.art.startsWith("/") ? `${st.haUrl ?? ""}${media.art}` : media.art) : null;
  // perf bisect flags: ?bare=1 photo only (no veil, no view); ?noveil=1; ?notext=1 (view without shadows)
  const dbg = new URLSearchParams(location.search);
  const bare = dbg.has("bare");

  return (
    <>
      {cur?.id === "media" && art ? <div className={`media-bg on`} style={{ backgroundImage: `url("${art}")` }} /> : <PhotoLayer photos={dbg.has("nophoto") ? [] : photos} sec={st.display.photoSec} on={wantPhoto && cur?.id !== "media"} onShow={setShown} />}
      {!wantPhoto && !bare && <div className="dk-flat" />}
      {!bare && !dbg.has("noveil") && <div className="dk-veil" />}
      {active && !bare && prev && prev !== cur?.id && <div className="dk-view out" key={`out-${prev}`} />}
      {active && !bare && cur && (
        <div className={`dk-view ${cur.id} ${dbg.has("notext") ? "notext" : ""}`} key={cur.id}>
          <View id={cur.id} st={st} tick={tick} api={api} media={media} art={art} photo={wantPhoto ? shown : undefined} />
        </div>
      )}
      {active && !bare && cur && cur.id !== "clock" && cur.id !== "weather" && <Strip st={st} tick={tick} />}
    </>
  );
}

/* two <div>s crossfade; Ken Burns runs on the visible one */
function PhotoLayer({ photos, sec, on, onShow }: { photos: Photo[]; sec: number; on: boolean; onShow: (p: Photo | undefined) => void }) {
  const [i, setI] = React.useState(0);
  const [slot, setSlot] = React.useState(0);
  const urls = React.useRef<[string | null, string | null]>([null, null]);
  const reduced = typeof matchMedia !== "undefined" && (matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("nokb"));

  // Random order that alternates sources (a Met run of eight would otherwise
  // look like one museum), reshuffled only when the pool itself changes.
  const order = React.useMemo(() => {
    const groups = new Map<string, Photo[]>();
    for (const p of photos) groups.set(p.source ?? "", [...(groups.get(p.source ?? "") ?? []), p]);
    for (const g of groups.values()) g.sort(() => Math.random() - 0.5);
    const out: Photo[] = [];
    const lists = [...groups.values()].sort(() => Math.random() - 0.5);
    while (lists.some((l) => l.length)) for (const l of lists) if (l.length) out.push(l.pop()!);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on pool identity, not on element order
  }, [photos.map((p) => p.url).join("|")]);

  React.useEffect(() => {
    if (!order.length) return;
    const id = setInterval(() => setI((x) => (x + 1) % order.length), sec * 1000);
    return () => clearInterval(id);
  }, [order.length, sec]);

  const cur = order[i % Math.max(1, order.length)];
  const url = cur?.url ?? null;
  React.useEffect(() => {
    if (!url || !cur) return;
    let alive = true;
    const img = new Image();
    img.src = url;
    // decode() keeps the JPEG decode off the frame that swaps the slot
    img.decode().then(() => {
      if (!alive) return;
      setSlot((sl) => {
        const nx = (sl + 1) % 2;
        urls.current[nx] = url;
        return nx;
      });
      onShow(cur);
    }).catch(() => {
      // broken URL: skip it instead of showing the previous photo under a wrong caption
      if (alive) setI((x) => (x + 1) % Math.max(1, order.length));
    });
    return () => {
      alive = false;
    };
  }, [url, cur, order.length, onShow]);

  return (
    <>
      {[0, 1].map((k) => {
        const u = urls.current[k];
        const vis = on && slot === k && !!u;
        const seed = (u ?? "").length;
        return (
          // Measured on the Hub (docs/home-assistant.md): a 108 %-oversized layer with
          // will-change ran at 44 fps; a 100 % <img> scaled from a corner origin runs at 60.
          // eslint-disable-next-line @next/next/no-img-element -- external photo CDN, no optimisation wanted
          <img
            key={`${k}-${u ?? ""}`}
            alt=""
            src={u ?? undefined}
            decoding="async"
            className={`dk-photo ${vis ? "on" : ""} ${vis && !reduced ? "kb" : ""} ${new URLSearchParams(location.search).has("static") ? "static" : ""}`}
            style={u ? ({ "--kb": `${sec + 4}s`, "--kbo": `${seed % 2 ? 35 : 65}% ${seed % 3 ? 40 : 60}%` } as React.CSSProperties) : undefined}
          />
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ views */
function View({ id, st, tick, api, media, art, photo }: { id: DisplayViewId; st: State; tick: number; api: (p: string, i?: RequestInit) => Promise<Response>; media: Media | null; art: string | null; photo?: Photo }) {
  const d = new Date(tick);
  switch (id) {
    case "clock": {
      const w = st.weather;
      const t = num(w?.attributes.temperature, NaN);
      const inside = Number(st.inside?.temp?.state);
      const next = (st.calendar ?? [])[0];
      return (
        <div className="clock" style={{ display: "contents" }}>
          <div style={{ alignSelf: "end" }}>
            <div className="time">{hhmm(tick)}</div>
            <div className="date">{DAYS[d.getDay()]}, {d.getDate()} {MONTHS[d.getMonth()]}{next ? ` · ${typeof next.start === "number" ? hhmm(next.start) : ""} ${next.title}` : ""}</div>
          </div>
          <div className="side">
            {Number.isFinite(t) && (
              <>
                <div className="t">{Math.round(t)}°</div>
                <div className="s">{COND[w?.state ?? ""] ?? ""} {COND_RO[w?.state ?? ""] ?? w?.state}{Number.isFinite(inside) ? ` · ${inside.toFixed(1)}° în dormitor` : ""}</div>
              </>
            )}
          </div>
          {photo && <Caption p={photo} />}
        </div>
      );
    }
    case "weather": {
      const w = st.weather;
      const hours = (st.hourly ?? []).filter((h) => h.t > tick - 1800e3).slice(0, 8);
      const days = (st.forecast ?? []).slice(0, 5);
      return (
        <div style={{ display: "grid", gridTemplateRows: "1fr auto", gap: 18, alignContent: "end" }}>
          <div className="row" style={{ alignItems: "center", gap: 28 }}>
            <div className="num" style={{ fontSize: 150 }}>{Math.round(num(w?.attributes.temperature))}°</div>
            <div>
              <div style={{ fontSize: 34, fontWeight: 600 }}>{COND_RO[w?.state ?? ""] ?? w?.state}</div>
              <div className="muted" style={{ fontSize: 22, marginTop: 6 }}>umiditate {num(w?.attributes.humidity)} % · vânt {Math.round(num(w?.attributes.wind_speed))} km/h · {num(w?.attributes.pressure)} hPa</div>
            </div>
          </div>
          <div className="plate" style={{ display: "grid", gridTemplateColumns: `repeat(${hours.length + days.length}, 1fr)`, gap: 6, padding: "18px 22px" }}>
            {hours.map((h) => (
              <div key={h.t} style={{ textAlign: "center" }}>
                <div className="muted" style={{ fontSize: 15 }}>{hhmm(h.t)}</div>
                <div style={{ fontSize: 26, margin: "4px 0" }}>{COND[h.cond] ?? "·"}</div>
                <div style={{ fontSize: 22 }}>{Math.round(h.temp)}°</div>
              </div>
            ))}
            {days.map((f) => (
              <div key={f.t} style={{ textAlign: "center", borderLeft: "1px solid var(--hair)" }}>
                <div className="muted" style={{ fontSize: 15 }}>{DAYS[new Date(f.t).getDay()]?.slice(0, 3)}</div>
                <div style={{ fontSize: 26, margin: "4px 0" }}>{COND[f.cond] ?? "·"}</div>
                <div style={{ fontSize: 20 }}>{Math.round(f.hi)}° <span className="muted">{Math.round(f.lo)}°</span></div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "home": {
      const h = st.home;
      const inside = Number(st.inside?.temp?.state);
      const hum = Number(st.inside?.hum?.state);
      const acs = st.devices.filter((x) => x.kind === "ac" && x.entity).map((x) => ({ d: x, e: st.entities[x.entity!] })).filter((x) => x.e);
      const low = (st.batteries ?? []).filter((b) => b.pct < 25);
      return (
        <div style={{ alignContent: "end" }}>
          <div className="plate" style={{ maxWidth: 560, display: "grid", gap: 16 }}>
            <h2>Casa</h2>
            <div className="row" style={{ gap: 36 }}>
              <div><div className="num" style={{ fontSize: 72 }}>{Number.isFinite(inside) ? inside.toFixed(1) : "—"}°</div><div className="muted">dormitor{Number.isFinite(hum) ? ` · ${Math.round(hum)} %` : ""}</div></div>
              <div><div className="num" style={{ fontSize: 72 }} >{h?.lightsOn ?? 0}<span className="muted" style={{ fontSize: 30 }}>/{h?.lightsTotal ?? "–"}</span></div><div className="muted">lumini aprinse</div></div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 19 }}>
              <span className={h?.door?.state === "on" ? "accent" : "muted"}>ușa {h?.door?.state === "on" ? "deschisă" : "închisă"}</span>
              <span className="muted">·</span>
              <span className={h?.presence?.state === "on" ? "accent" : "muted"}>{h?.presence?.state === "on" ? "cineva acasă" : h?.presence?.state === "unavailable" ? "senzor prezență offline" : "nimeni în dormitor"}</span>
              {acs.map(({ d: dev, e }) =>
                e ? (
                  <React.Fragment key={dev.id}><span className="muted">·</span><span className={e.state !== "off" ? "cool" : "muted"}>{dev.name} {e.state === "off" ? "oprit" : `${e.state} ${num(e.attributes.temperature)}°`}</span></React.Fragment>
                ) : null,
              )}
              {low.length > 0 && <><span className="muted">·</span><span className="accent">baterie: {low.map((b) => `${b.name} ${b.pct}%`).join(", ")}</span></>}
            </div>
          </div>
          {photo && <Caption p={photo} />}
        </div>
      );
    }
    case "media": {
      if (!media) return null;
      const pos = media.position != null && media.positionAt ? media.position + (media.state === "playing" ? (tick - new Date(media.positionAt).getTime()) / 1000 : 0) : null;
      const dur = media.duration ?? 0;
      return (
        <div className="media" style={{ display: "grid" }}>
          <div className="art" style={art ? { backgroundImage: `url("${art}")` } : { background: "oklch(1 0 0 / 0.1)" }} />
          <div>
            <div className="muted" style={{ fontSize: 17, letterSpacing: ".12em", textTransform: "uppercase" }}>{media.app ?? ""} · {media.name}</div>
            <div className="title">{media.title ?? "—"}</div>
            <div className="artist">{media.artist ?? ""}</div>
            {dur > 0 && pos != null && (
              <div className="prog">
                <div className="bar"><i style={{ "--v": String(Math.min(1, pos / dur)) } as React.CSSProperties} /></div>
                <div className="row muted" style={{ justifyContent: "space-between", fontSize: 17, marginTop: 8 }}><span>{mmss(pos)}</span><span>{mmss(dur)}</span></div>
              </div>
            )}
          </div>
        </div>
      );
    }
    case "photo":
      return <div style={{ alignContent: "end" }}>{photo && <Caption p={photo} />}</div>;
    case "nutrition": {
      const n = st.nutrition;
      if (!n) return null;
      const w = n.water;
      return (
        <div style={{ alignContent: "end" }}>
          <div className="plate" style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 36, alignItems: "center", maxWidth: 820 }}>
            <Arc v={n.today.calories / Math.max(1, n.targets.calories)} big={String(n.today.calories)} small="kcal" />
            <Arc v={w.ml / Math.max(1, w.targetMl)} big={String(w.glasses)} small="pahare" cool />
            <div style={{ display: "grid", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Nutriție</h2>
              {(["protein", "carbs", "fats"] as const).map((k) => (
                <div key={k}>
                  <div className="row muted" style={{ justifyContent: "space-between", fontSize: 17 }}><span>{k === "protein" ? "proteine" : k === "carbs" ? "carbo" : "grăsimi"}</span><span>{Math.round(n.today[k])} / {n.targets[k]} g</span></div>
                  <div className="bar" style={{ marginTop: 6 }}><i style={{ "--v": String(Math.min(1, n.today[k] / Math.max(1, n.targets[k]))) } as React.CSSProperties} /></div>
                </div>
              ))}
              <div className="muted" style={{ fontSize: 17 }}>{w.ml} ml din {w.targetMl} ml apă{w.underPace ? " · sub ritm" : ""} · {n.today.meals} mese</div>
            </div>
          </div>
        </div>
      );
    }
    case "pc": {
      const hosts = Object.entries(st.pcs ?? {});
      return (
        <div style={{ alignContent: "end", display: "grid", gap: 14 }}>
          {hosts.slice(0, 2).map(([host, m]) => {
            const disks = (m.disks as Array<{ drive: string; pct: number; freeGb: number }> | undefined) ?? [];
            const focus = m.focus as { proc?: string; title?: string } | undefined;
            return (
              <div className="plate" key={host} style={{ display: "grid", gridTemplateColumns: "auto auto auto 1fr", gap: 28, alignItems: "center" }}>
                <Arc v={pct(m.cpu)} big={`${Math.round(num(m.cpu))}`} small="cpu %" />
                <Arc v={pct(m.gpu)} big={`${Math.round(num(m.gpu))}`} small={`gpu ${Math.round(num(m.gpuTemp))}°`} />
                <Arc v={pct(m.ram)} big={`${Math.round(num(m.ram))}`} small="ram %" cool />
                <div>
                  <h2>{host}</h2>
                  {focus?.title && <div style={{ fontSize: 24, fontWeight: 600, textWrap: "balance" as never }}>{focus.title}</div>}
                  <div className="muted" style={{ fontSize: 17, marginTop: 8 }}>{focus?.proc ? `${focus.proc} · ` : ""}up {fmtUp(num(m.uptime))}{disks.length ? ` · ${disks.map((x) => `${x.drive} ${Math.round(x.freeGb)} GB liber`).join(" · ")}` : ""}</div>
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    case "pi": {
      const p = st.pi;
      if (!p) return null;
      const thr = (p.throttled as { undervolt?: boolean; capped?: boolean; throttled?: boolean; softTemp?: boolean } | undefined) ?? {};
      const disk = p.disk as { pct?: number; freeGb?: number } | undefined;
      const flags = [thr.undervolt && "sub-tensiune", thr.capped && "frecvență limitată", thr.throttled && "throttled", thr.softTemp && "limită termică"].filter(Boolean);
      return (
        <div style={{ alignContent: "end" }}>
          <div className="plate" style={{ display: "grid", gridTemplateColumns: "auto auto auto 1fr", gap: 28, alignItems: "center", maxWidth: 900 }}>
            <Arc v={pct(p.cpu)} big={`${Math.round(num(p.cpu))}`} small={`cpu · ${num(p.mhz)} MHz`} />
            <Arc v={Math.min(1, num(p.temp) / 85)} big={`${Math.round(num(p.temp))}°`} small="soc" />
            <Arc v={pct(p.ram)} big={`${Math.round(num(p.ram))}`} small="ram %" cool />
            <div>
              <h2>Raspberry Pi</h2>
              <div className="row" style={{ gap: 18 }}>
                <span style={{ fontSize: 34, fontWeight: 200 }} className={thr.undervolt ? "accent" : ""}>{num(p.coreV).toFixed(2)} V</span>
                <span className="muted" style={{ fontSize: 18 }}>core{num(p.dips) ? ` · ${num(p.dips)} căderi` : ""}</span>
              </div>
              <div className="muted" style={{ fontSize: 17, marginTop: 8 }}>
                load {num(p.load).toFixed(2)} · {num(p.containers)} containere · up {fmtUp(num(p.uptime))}{disk ? ` · disc ${Math.round(num(disk.freeGb))} GB liber` : ""} · ↓{Math.round(num(p.rxKbps))} ↑{Math.round(num(p.txKbps))} kb/s
              </div>
              {flags.length > 0 && <div className="accent" style={{ fontSize: 17, marginTop: 6 }}>{flags.join(" · ")}</div>}
            </div>
          </div>
        </div>
      );
    }
    case "calendar": {
      const ev = (st.calendar ?? []).slice(0, 5);
      return (
        <div style={{ alignContent: "end" }}>
          <div className="plate" style={{ maxWidth: 620, display: "grid", gap: 10 }}>
            <h2>Urmează</h2>
            {ev.map((e, i) => {
              const t = typeof e.start === "number" ? e.start : Date.parse(e.start);
              const dd = new Date(t);
              return (
                <div className="row" key={i} style={{ gap: 18, fontSize: 24 }}>
                  <span className="muted" style={{ minWidth: 150, fontSize: 19 }}>{DAYS[dd.getDay()]?.slice(0, 3)} {dd.getDate()} {e.allDay ? "" : hhmm(t)}</span>
                  <span style={{ fontWeight: 600 }}>{e.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    case "fx": {
      const fx = st.fx;
      if (!fx) return null;
      return (
        <div style={{ alignContent: "end" }}>
          <div className="plate" style={{ display: "grid", gridTemplateColumns: `repeat(${fx.rates.length}, 1fr)`, gap: 30, maxWidth: 760 }}>
            {fx.rates.map((r) => {
              const dlt = r.rate - r.prev;
              return (
                <div key={r.code}>
                  <h2>{r.code}</h2>
                  <div className="num" style={{ fontSize: 64 }}>{r.rate.toFixed(4)}</div>
                  <div className={dlt >= 0 ? "accent" : "cool"} style={{ fontSize: 19, marginTop: 6 }}>{dlt >= 0 ? "▲" : "▼"} {Math.abs(dlt).toFixed(4)} <span className="muted">RON · BNR {fx.date}</span></div>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    case "crypto": {
      const c = (st.crypto ?? []).slice(0, 3);
      return (
        <div style={{ alignContent: "end" }}>
          <div className="plate" style={{ display: "grid", gridTemplateColumns: `repeat(${c.length}, 1fr)`, gap: 30, maxWidth: 760 }}>
            {c.map((x) => (
              <div key={x.symbol}>
                <h2>{x.symbol}</h2>
                <div className="num" style={{ fontSize: 60 }}>${Math.round(x.price).toLocaleString("en-US")}</div>
                <div className={x.change24h >= 0 ? "accent" : "cool"} style={{ fontSize: 19, marginTop: 6 }}>{x.change24h >= 0 ? "▲" : "▼"} {Math.abs(x.change24h).toFixed(2)} % <span className="muted">24 h</span></div>
              </div>
            ))}
          </div>
        </div>
      );
    }
  }
  return null;
}

function Caption({ p }: { p: Photo }) {
  if (!p.title && !p.credit) return null;
  return <div className="caption">{p.title}{p.credit ? <span className="muted"> · {p.credit}</span> : null}</div>;
}
/* Clock + outside weather, top-right, on every panel that does not already
   carry them (clock, weather). Same figures as the clock view, smaller. */
function Strip({ st, tick }: { st: State; tick: number }) {
  const w = st.weather;
  const t = num(w?.attributes.temperature, NaN);
  return (
    <div className="strip">
      <div className="strip-time">{hhmm(tick)}</div>
      {Number.isFinite(t) && (
        <div className="strip-w">
          <span className="strip-t">{Math.round(t)}°</span>
          <span className="muted">{COND[w?.state ?? ""] ?? ""} {COND_RO[w?.state ?? ""] ?? w?.state}</span>
        </div>
      )}
    </div>
  );
}
function Arc({ v, big, small, cool }: { v: number; big: string; small: string; cool?: boolean }) {
  return (
    <div className="arc" style={cool ? ({ "--accent": "var(--cool)" } as React.CSSProperties) : undefined}>
      <svg viewBox="0 0 140 140"><circle className="tr" cx="70" cy="70" r="54" /><circle className="va" cx="70" cy="70" r="54" style={{ "--v": String(Math.max(0, Math.min(1, v))) } as React.CSSProperties} /></svg>
      <div className="lab"><b>{big}</b><span>{small}</span></div>
    </div>
  );
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtUp = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} z ${Math.floor((s % 86400) / 3600)} h` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m`);

/* ------------------------------------------------------------------ home screen */
type Cmd = Record<string, unknown>;
function Home({ st, tick, api, onTouch }: { st: State; tick: number; api: (p: string, i?: RequestInit) => Promise<Response>; onTouch: () => void }) {
  const rooms = st.rooms.filter((r) => st.devices.some((d) => d.room === r.id && d.entity));
  const [room, setRoom] = React.useState(rooms[0]?.id ?? "bedroom");
  const [sheet, setSheet] = React.useState<Device | "ambilight" | "water" | null>(null);
  const [pending, setPending] = React.useState<Record<string, Ent>>({});
  const send = React.useCallback(
    async (c: Cmd, optimistic?: { entity: string; patch: Partial<Ent> }) => {
      onTouch();
      if (optimistic) setPending((p) => ({ ...p, [optimistic.entity]: { ...(st.entities[optimistic.entity] ?? { state: "", attributes: {} }), ...optimistic.patch } }));
      try {
        await api("control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
      } finally {
        setTimeout(() => setPending((p) => { const n = { ...p }; if (optimistic) delete n[optimistic.entity]; return n; }), 2500);
      }
    },
    [api, onTouch, st.entities],
  );
  const ent = (id?: string): Ent | undefined => (id ? pending[id] ?? st.entities[id] : undefined);
  const devs = st.devices.filter((d) => d.room === room && d.entity && !["proxy", "monitor", "pc"].includes(d.kind));
  const hyper = ent("light.hyperhdr");
  const water = st.nutrition?.water;

  const openSheet = (s: Device | "ambilight" | "water") => {
    onTouch();
    const d = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (d.startViewTransition) d.startViewTransition(() => setSheet(s));
    else setSheet(s);
  };

  return (
    <div className="home-ui" onPointerDown={onTouch}>
      <div className="tabs">
        {rooms.map((r) => (
          <button key={r.id} className={`tab ${room === r.id ? "on" : ""}`} onClick={() => setRoom(r.id)}>{ROOM_RO[r.id] ?? r.name}</button>
        ))}
        <button className={`tab ${room === "scene" ? "on" : ""}`} onClick={() => setRoom("scene")}>Scene</button>
        <span className="sp" />
        <span className="clk">{hhmm(tick)}</span>
      </div>
      <div className="grid">
        {room === "scene" ? (
          <>
            <Tile i={0} on={!!hyper && hyper.state === "on"} k="ambilight" n={hyper?.state === "on" ? (String(hyper.attributes.effect ?? "").startsWith("Music") ? "Music" : "Movie") : "oprit"} onTap={() => openSheet("ambilight")} onLong={() => openSheet("ambilight")} />
            <Tile i={1} cool on={false} k="apă" n={water ? `${water.glasses} pahare · ${water.ml} ml` : "—"} v={water ? <>{Math.round((water.ml / Math.max(1, water.targetMl)) * 100)}<small>%</small></> : undefined} onTap={() => void send({ type: "water", ml: 250 })} onLong={() => openSheet("water")} />
            <Tile i={2} on={false} k="pc" n="Trezește PC-ul" onTap={() => void send({ type: "script", name: "pc_wake" })} />
            <Tile i={3} on={false} k="lumini" n="Stinge tot" onTap={() => { for (const d of st.devices) if (d.entity?.startsWith("light.") && ent(d.entity)?.state === "on") void send({ type: "toggle", entity: d.entity, on: false }, { entity: d.entity, patch: { state: "off" } }); }} />
          </>
        ) : (
          devs.map((d, i) => <DeviceTile key={d.id} i={i} d={d} e={ent(d.entity)} send={send} open={() => openSheet(d)} />)
        )}
      </div>
      {sheet && <Sheet s={sheet} st={st} ent={ent} send={send} close={() => setSheet(null)} />}
    </div>
  );
}

function Tile({ i, on, cool, k, n, v, wide, onTap, onLong }: { i: number; on: boolean; cool?: boolean; k: string; n: string; v?: React.ReactNode; wide?: boolean; onTap?: () => void; onLong?: () => void }) {
  const t = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = React.useRef(false);
  return (
    <button
      className={`tile ${on ? "on" : ""} ${cool ? "cool" : ""} ${wide ? "wide" : ""}`}
      style={{ "--i": String(i) } as React.CSSProperties}
      onPointerDown={() => { fired.current = false; if (onLong) t.current = setTimeout(() => { fired.current = true; onLong(); }, 480); }}
      onPointerUp={() => { if (t.current) clearTimeout(t.current); if (!fired.current) onTap?.(); }}
      onPointerLeave={() => { if (t.current) clearTimeout(t.current); }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="k">{k}</span>
      {v !== undefined && <span className="v">{v}</span>}
      <span className="n">{n}</span>
      <i className="dot" />
    </button>
  );
}

function DeviceTile({ i, d, e, send, open }: { i: number; d: Device; e?: Ent; send: (c: Cmd, o?: { entity: string; patch: Partial<Ent> }) => Promise<void>; open: () => void }) {
  const id = d.entity!;
  const on = !!e && !["off", "unavailable", "unknown", "standby", "idle"].includes(e.state);
  const kind = d.kind;
  const un = !e || e.state === "unavailable";
  if (kind === "ac") {
    const cur = num(e?.attributes.current_temperature, NaN);
    const target = num(e?.attributes.temperature, 24);
    return (
      <Tile i={i} cool on={on} k={`AC · ${e?.state === "off" ? "oprit" : e?.state ?? "—"}`} n={`${d.name}${Number.isFinite(cur) ? ` · ${cur}° în cameră` : ""}`} v={<>{target}<small>°</small></>} wide
        onTap={() => void send({ type: "toggle", entity: id, on: !on }, { entity: id, patch: { state: on ? "off" : "cool" } })} onLong={open} />
    );
  }
  if (kind === "sensor") {
    return <Tile i={i} on={false} k="senzor" n={d.name} v={<>{Number(e?.state).toFixed(1)}<small>{String(e?.attributes.unit_of_measurement ?? "")}</small></>} />;
  }
  if (kind === "door" || kind === "presence") {
    const yes = e?.state === "on";
    return <Tile i={i} on={yes} k={kind === "door" ? "ușă" : "prezență"} n={un ? "offline" : kind === "door" ? (yes ? "deschisă" : "închisă") : yes ? "cineva" : "nimeni"} />;
  }
  if (kind === "tv" || kind === "display") {
    const title = e?.attributes.media_title as string | undefined;
    return <Tile i={i} on={on} k={String(e?.attributes.app_name ?? kind)} n={title ? `${d.name} · ${title}` : d.name} onTap={() => void send({ type: "media", entity: id, command: on ? "turn_off" : "turn_on" })} onLong={open} />;
  }
  const br = num(e?.attributes.brightness, 0);
  return (
    <Tile i={i} on={on} k={d.via.split(" ")[0] ?? "lumină"} n={d.name} v={on && br ? <>{Math.round((br / 255) * 100)}<small>%</small></> : undefined}
      onTap={() => !un && void send({ type: "toggle", entity: id, on: !on }, { entity: id, patch: { state: on ? "off" : "on" } })} onLong={open} />
  );
}

function Sheet({ s, st, ent, send, close }: { s: Device | "ambilight" | "water"; st: State; ent: (id?: string) => Ent | undefined; send: (c: Cmd, o?: { entity: string; patch: Partial<Ent> }) => Promise<void>; close: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (s === "ambilight") {
    const hyper = ent("light.hyperhdr");
    const eff = String(hyper?.attributes.effect ?? "");
    const mode = hyper?.state !== "on" ? "off" : eff.startsWith("Music") ? "music" : "movie";
    return (
      <>
        <div className="sheet-bg" onPointerDown={close} />
        <div className="sheet" onPointerDown={stop}>
          <div><h3>Ambilight</h3><div className="sub">ecranul conduce luminile · HyperHDR</div></div>
          <div className="btns">
            {(["movie", "music", "off"] as const).map((m) => <button key={m} className={`b ${mode === m ? "on" : ""}`} onClick={() => void send({ type: "ambilight", mode: m }).then(close)}>{m === "movie" ? "Movie" : m === "music" ? "Music" : "Cameră caldă"}</button>)}
          </div>
        </div>
      </>
    );
  }
  if (s === "water") {
    const w = st.nutrition?.water;
    return (
      <>
        <div className="sheet-bg" onPointerDown={close} />
        <div className="sheet" onPointerDown={stop}>
          <div><h3>Apă</h3><div className="sub">{w ? `${w.ml} ml din ${w.targetMl} ml · ${w.glasses} pahare` : ""}</div></div>
          <div className="btns">
            {[100, 250, 330, 500].map((ml) => <button key={ml} className="b" onClick={() => void send({ type: "water", ml }).then(close)}>+{ml} ml</button>)}
            <button className="b" onClick={() => void send({ type: "water_undo" }).then(close)}>Anulează ultimul</button>
          </div>
        </div>
      </>
    );
  }
  const d = s;
  const id = d.entity!;
  const e = ent(id);
  if (d.kind === "ac") {
    const target = num(e?.attributes.temperature, 24);
    const modes = (e?.attributes.hvac_modes as string[] | undefined) ?? ["off", "cool", "heat", "dry", "fan_only", "auto"];
    const fans = (e?.attributes.fan_modes as string[] | undefined) ?? [];
    const RO: Record<string, string> = { off: "Oprit", cool: "Răcire", heat: "Încălzire", dry: "Dezumidificare", fan_only: "Ventilator", auto: "Auto", heat_cool: "Auto" };
    return (
      <>
        <div className="sheet-bg" onPointerDown={close} />
        <div className="sheet" onPointerDown={stop}>
          <div><h3>{d.name}</h3><div className="sub">{Number.isFinite(num(e?.attributes.current_temperature, NaN)) ? `${num(e?.attributes.current_temperature)}° în cameră · ` : ""}{RO[e?.state ?? ""] ?? e?.state}</div></div>
          <div className="bigtemp">
            <button onClick={() => void send({ type: "climate", entity: id, temperature: target - 1 }, { entity: id, patch: { attributes: { ...(e?.attributes ?? {}), temperature: target - 1 } } })}>−</button>
            <div className="t">{target}°</div>
            <button onClick={() => void send({ type: "climate", entity: id, temperature: target + 1 }, { entity: id, patch: { attributes: { ...(e?.attributes ?? {}), temperature: target + 1 } } })}>+</button>
          </div>
          <div className="btns">{modes.map((m) => <button key={m} className={`b ${e?.state === m ? "on" : ""}`} onClick={() => void send({ type: "climate", entity: id, hvacMode: m }, { entity: id, patch: { state: m } })}>{RO[m] ?? m}</button>)}</div>
          {fans.length > 0 && <div className="btns">{fans.map((f) => <button key={f} className={`b ${e?.attributes.fan_mode === f ? "on" : ""}`} style={{ fontSize: 18 }} onClick={() => void send({ type: "climate", entity: id, fanMode: f })}>{f.replace(/_/g, " ")}</button>)}</div>}
        </div>
      </>
    );
  }
  if (d.kind === "tv" || d.kind === "display") {
    const cmds: Array<[string, string]> = [["previous_track", "⏮"], ["play_pause", "⏯"], ["next_track", "⏭"], ["volume_down", "🔉"], ["volume_up", "🔊"], ["volume_mute", "🔇"], ["turn_off", "⏻"]];
    return (
      <>
        <div className="sheet-bg" onPointerDown={close} />
        <div className="sheet" onPointerDown={stop}>
          <div><h3>{d.name}</h3><div className="sub">{String(e?.attributes.app_name ?? "")} {e?.attributes.media_title ? `· ${String(e.attributes.media_title)}` : ""}</div></div>
          <div className="btns">{cmds.map(([c, g]) => <button key={c} className="b" style={{ fontSize: 30 }} onClick={() => void send({ type: "media", entity: id, command: c })}>{g}</button>)}</div>
        </div>
      </>
    );
  }
  // light
  const on = e?.state === "on";
  const br = Math.round((num(e?.attributes.brightness, 0) / 255) * 100);
  const swatches: Array<[number, number, number]> = [[255, 180, 90], [255, 120, 60], [255, 60, 80], [200, 80, 255], [80, 140, 255], [60, 220, 200], [120, 255, 120], [255, 255, 255]];
  return (
    <>
      <div className="sheet-bg" onPointerDown={close} />
      <div className="sheet" onPointerDown={stop}>
        <div><h3>{d.name}</h3><div className="sub">{d.via}{on ? ` · ${br} %` : " · oprită"}</div></div>
        <input className="slider" type="range" min={1} max={100} defaultValue={br || 60} onChange={(ev) => void send({ type: "light", entity: id, brightnessPct: Number(ev.currentTarget.value) }, { entity: id, patch: { state: "on", attributes: { ...(e?.attributes ?? {}), brightness: Math.round((Number(ev.currentTarget.value) / 100) * 255) } } })} />
        {!d.whiteOnly && (
          <div className="swatches">
            {swatches.map((c) => <button key={c.join()} style={{ background: `rgb(${c.join(",")})` }} onClick={() => void send({ type: "light", entity: id, rgb: c }, { entity: id, patch: { state: "on" } })} />)}
          </div>
        )}
        <div className="btns">
          <button className={`b ${!on ? "on" : ""}`} onClick={() => void send({ type: "toggle", entity: id, on: false }, { entity: id, patch: { state: "off" } })}>Oprit</button>
          <button className={`b ${on ? "on" : ""}`} onClick={() => void send({ type: "toggle", entity: id, on: true }, { entity: id, patch: { state: "on" } })}>Aprins</button>
          {d.whiteOnly && [2700, 4000, 5500].map((k) => <button key={k} className="b" onClick={() => void send({ type: "light", entity: id, kelvin: k })}>{k} K</button>)}
        </div>
      </div>
    </>
  );
}
