import { getCurrentWindow } from "@tauri-apps/api/window";
import { Activity, Cpu, Home, Lightbulb, Minus, MonitorSmartphone, Settings2, Square, X } from "lucide-react";
import * as React from "react";
import { api, cn, useEvent, useToasts, type Health } from "./lib";
import { Ambilight } from "./pages/Ambilight";
import { Casa } from "./pages/Casa";
import { PendingBanner } from "./pages/Devices";
import { UpdateBanner } from "./pages/Update";
import { Ecrane } from "./pages/Ecrane";
import { Pc } from "./pages/Pc";
import { Servicii } from "./pages/Servicii";
import { Setup } from "./pages/Setup";
import { PlatformProvider, useAppInfo, usePlatform } from "./platform";

type PageId = "ambilight" | "casa" | "ecrane" | "servicii" | "pc";
const PAGES: Array<{ id: PageId; label: string; icon: React.ReactNode; el: React.ReactNode; mobileLabel?: string }> = [
  { id: "casa", label: "Casă", icon: <Home className="size-4" />, el: <Casa /> },
  { id: "ambilight", label: "Ambilight", icon: <Lightbulb className="size-4" />, el: <Ambilight /> },
  { id: "ecrane", label: "Ecrane", icon: <MonitorSmartphone className="size-4" />, el: <Ecrane /> },
  { id: "pc", label: "PC", icon: <Cpu className="size-4" />, el: <Pc /> },
  { id: "servicii", label: "Servicii", icon: <Activity className="size-4" />, el: <Servicii />, mobileLabel: "Pi" },
];

export const HealthCtx = React.createContext<Health | null>(null);

export function App() {
  const { info, refresh } = useAppInfo();
  if (!info) return <div className="bg-scene h-full" />;
  return (
    <PlatformProvider value={info}>
      <Shell onConfigured={refresh} />
    </PlatformProvider>
  );
}

function Shell({ onConfigured }: { onConfigured: () => void }) {
  const { mobile, vmui } = usePlatform();
  const [page, setPage] = React.useState<PageId>(() => (localStorage.getItem("vmui:page") as PageId) || (mobile ? "casa" : "ambilight"));
  const [setup, setSetup] = React.useState(false);
  const [health, setHealth] = React.useState<Health | null>(null);
  useEvent<Health>("health", setHealth);
  const poll = React.useCallback(() => api.health().then(setHealth).catch(() => undefined), []);
  React.useEffect(() => {
    void poll();
    // desktop pushes `health` events from the tray loop; the phone has no loop, so poll
    if (!mobile) return;
    const id = setInterval(() => document.visibilityState === "visible" && void poll(), 10000);
    return () => clearInterval(id);
  }, [mobile, poll]);
  React.useEffect(() => localStorage.setItem("vmui:page", page), [page]);

  if (mobile && (!vmui || setup)) return <Setup onDone={() => { setSetup(false); onConfigured(); void poll(); }} canCancel={!!vmui} onCancel={() => setSetup(false)} />;

  const cur = PAGES.find((p) => p.id === page) ?? PAGES[0]!;
  return (
    <HealthCtx.Provider value={health}>
      {mobile ? (
        <div className="bg-scene h-full grid grid-rows-[auto_1fr_auto]" style={{ paddingTop: "max(env(safe-area-inset-top), 28px)" }}>
          <header className="flex items-center gap-2.5 px-4 pt-2 pb-2 text-sm font-semibold">
            <span className={cn("dot", health?.state === "ok" && "text-ok bg-ok", health?.state === "warn" && "text-warn bg-warn", (!health || health.state === "down") && "text-down bg-down")} />
            vmui <span className="font-normal text-muted truncate">· {health?.detail ?? "se conectează…"}</span>
            <button type="button" className="btn ghost sm ml-auto" onClick={() => setSetup(true)} aria-label="Conexiune"><Settings2 className="size-4" /></button>
          </header>
          <main className="min-h-0 overflow-y-auto px-4 pb-4">
            <UpdateBanner />
            <PendingBanner />
            <div key={cur.id} className="page">{cur.el}</div>
          </main>
          <nav className="tabs" aria-label="Pagini" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 8px)" }}>
            {PAGES.map((p) => (
              <button key={p.id} type="button" className={cn(p.id === page && "on")} onClick={() => setPage(p.id)} aria-current={p.id === page ? "page" : undefined}>
                {p.icon}
                <span>{p.mobileLabel ?? p.label}</span>
              </button>
            ))}
          </nav>
          <Toasts />
        </div>
      ) : (
        <div className="bg-scene h-full grid grid-rows-[40px_1fr]">
          <TitleBar health={health} />
          <div className="grid grid-cols-[212px_1fr] min-h-0">
            <aside className="nav flex flex-col gap-1 p-3 pt-1">
              {PAGES.map((p) => (
                <button key={p.id} type="button" className={cn(p.id === page && "on")} onClick={() => setPage(p.id)} aria-current={p.id === page ? "page" : undefined}>
                  {p.icon}
                  {p.label}
                  {p.id === "servicii" && health && health.state !== "ok" && <span className={cn("dot ml-auto", health.state === "warn" ? "text-warn bg-warn" : "text-down bg-down")} />}
                </button>
              ))}
              <div className="mt-auto px-3 pb-1 text-[11px] text-dim leading-5">
                <div className="flex items-center gap-2"><span className={cn("dot", health?.vmui ? "text-ok bg-ok" : "text-down bg-down")} />vmui</div>
                <div className="flex items-center gap-2"><span className={cn("dot", health?.ha ? "text-ok bg-ok" : "text-down bg-down")} />Home Assistant</div>
                <div className="flex items-center gap-2"><span className={cn("dot", health?.hyper ? "text-ok bg-ok" : "text-down bg-down")} />HyperHDR</div>
              </div>
            </aside>
            <main className="min-h-0 overflow-y-auto px-6 pb-8 pt-1">
              <div className="mx-auto max-w-[980px]"><PendingBanner /></div>
              <div key={cur.id} className="page mx-auto max-w-[980px]">{cur.el}</div>
            </main>
          </div>
          <Toasts />
        </div>
      )}
    </HealthCtx.Provider>
  );
}

function TitleBar({ health }: { health: Health | null }) {
  const w = getCurrentWindow();
  const tone = health?.state ?? "warn";
  return (
    <header data-tauri-drag-region className="flex items-center gap-3 px-4 select-none" onDoubleClick={() => void w.toggleMaximize()}>
      <div data-tauri-drag-region className="flex items-center gap-2.5 text-sm font-semibold">
        <span className={cn("dot", tone === "ok" && "text-ok bg-ok", tone === "warn" && "text-warn bg-warn", tone === "down" && "text-down bg-down")} />
        vmui
        <span className="font-normal text-muted">· {health?.detail ?? "se conectează…"}</span>
      </div>
      <div className="ml-auto flex items-center">
        <button type="button" className="btn ghost sm" aria-label="Minimizează" onClick={() => void w.minimize()}><Minus className="size-4" /></button>
        <button type="button" className="btn ghost sm" aria-label="Maximizează" onClick={() => void w.toggleMaximize()}><Square className="size-3.5" /></button>
        <button type="button" className="btn ghost sm hover:text-down" aria-label="Închide în tray" onClick={() => void w.hide()}><X className="size-4" /></button>
      </div>
    </header>
  );
}

function Toasts() {
  const list = useToasts();
  useEvent<{ kind: "ok" | "error" | "info"; text: string }>("toast", (t) => import("./lib").then((m) => m.toast(t.kind, t.text)));
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 left-4 flex flex-col items-end gap-2 md:bottom-4 md:left-auto" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cn("glass px-4 py-2.5 text-sm", t.kind === "error" && "border-down/50 text-down", t.kind === "ok" && "border-ok/40")}>{t.text}</div>
      ))}
    </div>
  );
}
