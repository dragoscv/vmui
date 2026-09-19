import { RefreshCw, ScrollText } from "lucide-react";
import * as React from "react";
import { api, cn, useAction, usePoll } from "../lib";
import { Card, Stat } from "../ui";
import { DevicesCard } from "./Devices";

type PiState = {
  units: Array<{ name: string; status: string; running: boolean }>;
  containers: Array<{ name: string; status: string; running: boolean }>;
  uptimeSec: number;
  tempC: number;
  throttled: string | null;
  mem: { usedMB: number; totalMB: number };
  disk: { used: string; size: string; pct: string };
  note?: string;
};
const WHAT: Record<string, string> = {
  vmui: "Next.js :3737 — Nest Hub, Turzx, API-ul acestei aplicații",
  turzx: "renderer pentru ecranul 3.5\" (publică și metricile Pi)",
  "desk-button": "butonul de birou → apă / scene",
  "hub-cast": "re-trimite /display pe Nest Hub",
  caddy: "https://home.dragoscatalin.ro → HA",
  tailscaled: "VPN + subnet router 192.168.100.0/24",
  docker: "containerele de mai jos",
  homeassistant: "Home Assistant (host network, :80)",
  esphome: "firmware ESP32 (:6052)",
  mosquitto: "MQTT :1883 — HA ↔ HyperHDR ↔ agentul PC",
};

/** The Raspberry Pi's services, from vmui's /api/desktop/pi (systemctl, docker, vcgencmd). */
export function Pi() {
  const st = usePoll(() => api.vmuiGet<PiState>("/api/desktop/pi"), 8000);
  const { busy, run } = useAction();
  const [log, setLog] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    if (!log) return;
    const tail = () => api.vmuiGet<{ text: string }>(`/api/desktop/pi?log=${log}`).then((r) => setText(r.text)).catch((e) => setText(String(e)));
    void tail();
    const id = setInterval(() => document.visibilityState === "visible" && void tail(), 5000);
    return () => clearInterval(id);
  }, [log]);
  const s = st.data;
  if (!s) return <div className="text-sm text-dim">{st.error ? `Pi nu răspunde: ${st.error}` : "se încarcă…"}</div>;
  const up = s.uptimeSec ? `${Math.floor(s.uptimeSec / 86400)} z ${Math.floor((s.uptimeSec % 86400) / 3600)} h` : "—";
  const thr = s.throttled && s.throttled !== "0x0";
  const act = (unit: string, action: "restart" | "start" | "stop") => run(unit, () => api.vmuiSend("POST", "/api/desktop/pi", { unit, action }).then(() => st.refresh()), `${unit}: ${action}`);
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Raspberry Pi</h1>
        <p className="text-sm text-muted mt-1">homepi · serverul casei</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat k="Uptime" v={up} />
        <Stat k="Temperatură" v={Number.isFinite(s.tempC) ? `${s.tempC.toFixed(1)} °C` : "—"} tone={s.tempC > 70 ? "warn" : "ok"} />
        <Stat k="Alimentare" v={thr ? `throttled ${s.throttled}` : "ok"} tone={thr ? "down" : "ok"} />
        <Stat k="RAM · disc" v={`${Math.round((s.mem.usedMB / Math.max(1, s.mem.totalMB)) * 100)} % · ${s.disk.pct}`} />
      </div>
      <Card title="Unități systemd" right={<button type="button" className="btn ghost sm" onClick={() => void st.refresh()}><RefreshCw className="size-3.5" /></button>}>
        <div className="grid gap-2">
          {s.units.map((u) => (
            <div key={u.name} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className={cn("dot", u.running ? "text-ok bg-ok" : "text-down bg-down")} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{u.name} <span className="text-dim font-normal">· {u.status}</span></div>
                <div className="text-xs text-muted truncate">{WHAT[u.name] ?? ""}</div>
              </div>
              <button type="button" className="btn ghost sm" aria-label={`Log ${u.name}`} onClick={() => setLog(u.name)}><ScrollText className="size-3.5" /></button>
              <button type="button" className="btn sm" disabled={busy === u.name} onClick={() => act(u.name, "restart")}><RefreshCw className="size-3.5" />Restart</button>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Containere Docker">
        <div className="grid gap-2">
          {s.containers.map((c) => (
            <div key={c.name} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className={cn("dot", c.running ? "text-ok bg-ok" : "text-down bg-down")} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.name} <span className="text-dim font-normal">· {c.status}</span></div>
                <div className="text-xs text-muted truncate">{WHAT[c.name] ?? ""}</div>
              </div>
              <button type="button" className="btn ghost sm" aria-label={`Log ${c.name}`} onClick={() => setLog(c.name)}><ScrollText className="size-3.5" /></button>
            </div>
          ))}
        </div>
      </Card>
      <DevicesCard />
      {log && (
        <Card title={`Log · ${log}`} sub="ultimele 150 de linii, se reîmprospătează la 5 s" right={<button type="button" className="btn ghost sm" onClick={() => setLog(null)}>închide</button>}>
          <pre className="log">{text || "(gol)"}</pre>
        </Card>
      )}
    </div>
  );
}
