import { FolderOpen, Play, RefreshCw, ScrollText, Square } from "lucide-react";
import * as React from "react";
import { HealthCtx } from "../App";
import { api, cn, useAction, usePoll } from "../lib";
import { Card, Stat } from "../ui";

const LABEL: Record<string, { name: string; what: string; log?: string; self?: boolean }> = {
  "vmui-ambilight-hyperhdr": { name: "HyperHDR", what: "captură ecran → LED-uri; JSON-API :8090", log: "hyperhdr" },
  "vmui-ambilight-openrgb": { name: "OpenRGB", what: "carcasă, placă, GPU prin SDK :6742", log: "openrgb" },
  "vmui-ambilight-bridges": { name: "Bridges", what: "dxlight + openrgb UDP → HID/SDK; video_follow", log: "bridges" },
  "vmui-service": { name: "vmui (local)", what: "Next.js pe 127.0.0.1:3737 — folosit doar de Hyper-V", log: "vmui" },
  "vmui-turzx": { name: "Turzx renderer", what: "ecranul 3.5\" de pe birou, COM11", log: "turzx" },
  "vmui-tray": { name: "Această aplicație", what: "tray + fereastra asta; pornește la logon cu --hidden", log: "desktop", self: true },
};

export function Servicii() {
  const health = React.useContext(HealthCtx);
  const tasks = usePoll(() => api.tasks(), 8000);
  const { busy, run } = useAction();
  const [log, setLog] = React.useState<string>("turzx");
  const [text, setText] = React.useState("");
  const tail = React.useCallback(() => api.tailLog(log, 200).then(setText).catch((e) => setText(String(e))), [log]);
  React.useEffect(() => {
    void tail();
    const id = setInterval(() => document.visibilityState === "visible" && void tail(), 4000);
    return () => clearInterval(id);
  }, [tail]);

  const list = tasks.data ?? health?.tasks ?? [];
  const running = list.filter((t) => t.running).length;
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Servicii</h1>
        <p className="text-sm text-muted mt-1">Task-urile din Task Scheduler care țin stack-ul în viață, și log-urile lor.</p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat k="Task-uri active" v={`${running} / ${list.length}`} tone={running === list.length ? "ok" : "warn"} />
        <Stat k="HyperHDR" v={health?.hyper ? health.source : "jos"} tone={health?.hyper ? "ok" : "down"} />
        <Stat k="vmui local" v={health?.vmui ? "răspunde" : "oprit"} tone={health?.vmui ? "ok" : "warn"} />
        <Stat k="Home Assistant" v={health?.ha ? "conectat" : "indisponibil"} tone={health?.ha ? "ok" : "down"} />
      </div>

      <Card title="Task-uri" right={<button type="button" className="btn ghost sm" onClick={() => void tasks.refresh()}><RefreshCw className="size-3.5" /></button>}>
        <div className="grid gap-2">
          {list.map((t) => {
            const m = LABEL[t.name] ?? { name: t.name, what: "" };
            return (
              <div key={t.name} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
                <span className={cn("dot", t.running ? "text-ok bg-ok" : t.status === "missing" ? "text-down bg-down" : "text-warn bg-warn")} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{m.name} <span className="text-dim font-normal">· {t.name}</span></div>
                  <div className="text-xs text-muted truncate">{m.what}</div>
                </div>
                <span className="text-xs text-muted w-16 text-right">{t.running ? "rulează" : t.status === "missing" ? "lipsește" : "oprit"}</span>
                {m.log && <button type="button" className="btn ghost sm" aria-label={`Log ${m.name}`} onClick={() => setLog(m.log!)}><ScrollText className="size-3.5" /></button>}
                {m.self ? <span className="text-xs text-dim">închide din tray → Ieșire</span> : t.running
                  ? <button type="button" className="btn sm" disabled={busy === t.name} onClick={() => run(t.name, () => api.taskAction(t.name, "stop").then(() => tasks.refresh()), `${m.name} oprit`)}><Square className="size-3.5" />Stop</button>
                  : <button type="button" className="btn sm" disabled={busy === t.name || t.status === "missing"} onClick={() => run(t.name, () => api.taskAction(t.name, "start").then(() => tasks.refresh()), `${m.name} pornit`)}><Play className="size-3.5" />Start</button>}
                {!m.self && <button type="button" className="btn sm" disabled={busy === t.name || t.status === "missing"} onClick={() => run(t.name, () => api.taskAction(t.name, "restart").then(() => tasks.refresh()), `${m.name} repornit`)}><RefreshCw className="size-3.5" />Restart</button>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title={`Log · ${log}`} sub=".copilot-tmp/service-logs, ultimele 200 de linii, se reîmprospătează la 4 s"
        right={<div className="flex gap-1">{["turzx", "bridges", "hyperhdr", "openrgb", "vmui", "desktop"].map((l) => <button key={l} type="button" className={cn("btn ghost sm", l === log && "on")} onClick={() => setLog(l)}>{l}</button>)}<button type="button" className="btn ghost sm" onClick={() => void api.openPath("logs")} aria-label="Deschide folderul de log-uri"><FolderOpen className="size-3.5" /></button></div>}>
        <pre className="log">{text || "(gol)"}</pre>
      </Card>
    </div>
  );
}
