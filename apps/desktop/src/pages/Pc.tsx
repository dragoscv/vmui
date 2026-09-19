import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { FolderOpen, Lock, MonitorOff, Moon, Power, RefreshCw, Snowflake, Volume2, VolumeX, Wrench } from "lucide-react";
import * as React from "react";
import { api, toast, useAction, usePoll } from "../lib";
import { Card, Row, Slider, Switch } from "../ui";

type Pcs = Record<string, { cpu?: number; ram?: number; gpu?: number; gpuTemp?: number; uptime?: number; focus?: { proc?: string; title?: string }; disks?: Array<{ name: string; pct: number }> }>;

export function Pc() {
  const { busy, run } = useAction();
  const [vol, setVol] = React.useState(30);
  const [auto, setAuto] = React.useState<boolean | null>(null);
  const [info, setInfo] = React.useState<{ root: string; version: string } | null>(null);
  const metrics = usePoll(() => api.vmuiGet<{ pcs?: Pcs }>("/api/display/state").then((s) => s.pcs ?? {}), 5000);
  React.useEffect(() => {
    void isEnabled().then(setAuto).catch(() => setAuto(null));
    void api.appInfo().then(setInfo).catch(() => undefined);
  }, []);

  const act = (a: string, ok?: string, v?: number) => run(a, () => api.pcAction(a, v), ok);
  const pcs = Object.entries(metrics.data ?? {});

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">PC</h1>
        <p className="text-sm text-muted mt-1">Aceleași verbe fixe ca în scripts/pc-action.ps1 — nimic arbitrar.</p>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <button type="button" className="tile" onClick={() => act("lock")} disabled={!!busy}><Lock className="size-5 text-primary" /><div><div className="font-medium">Blochează</div><div className="text-xs text-muted">Win+L</div></div></button>
        <button type="button" className="tile" onClick={() => act("display_off")} disabled={!!busy}><MonitorOff className="size-5 text-primary" /><div><div className="font-medium">Stinge monitoarele</div><div className="text-xs text-muted">se aprind la mișcare</div></div></button>
        <button type="button" className="tile" onClick={() => { if (confirm("Trimit PC-ul în sleep?")) void act("sleep"); }} disabled={!!busy}><Moon className="size-5 text-warn" /><div><div className="font-medium">Sleep</div><div className="text-xs text-muted">trezire de pe Hub / HA (WoL)</div></div></button>
        <button type="button" className="tile" onClick={() => act("unfreeze_vscode", "VS Code deblocat")} disabled={!!busy}><Snowflake className="size-5 text-accent" /><div><div className="font-medium">Deblochează VS Code</div><div className="text-xs text-muted">renderer înghețat</div></div></button>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Card title="Sunet">
          <div className="field"><span>Volum · {vol} %</span><Slider value={vol} min={0} max={100} onChange={setVol} onCommit={(v) => act("volume", undefined, v)} format={(v) => `${v} %`} /></div>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn" onClick={() => act("mute", "Mut")} disabled={!!busy}><VolumeX className="size-4" />Mut</button>
            <button type="button" className="btn" onClick={() => act("unmute", "Sunet pornit")} disabled={!!busy}><Volume2 className="size-4" />Sunet</button>
          </div>
        </Card>
        <Card title="Întreținere">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => act("restart_tunnel", "Tunnel repornit")} disabled={!!busy}><RefreshCw className="size-4" />Repornește tunnel-ul VS Code</button>
            <button type="button" className="btn" onClick={() => act("kill_runaway_renderer", "Renderer închis")} disabled={!!busy}><Wrench className="size-4" />Închide renderer-ul fugit</button>
            <button type="button" className="btn" onClick={() => act("restart_ambilight", "Ambilight repornit")} disabled={!!busy}><Power className="size-4" />Repornește ambilight</button>
            <button type="button" className="btn" onClick={() => act("restart_turzx", "Turzx repornit")} disabled={!!busy}><Power className="size-4" />Repornește Turzx</button>
            <button type="button" className="btn" onClick={() => act("restart_vmui", "vmui repornit")} disabled={!!busy}><Power className="size-4" />Repornește vmui local</button>
          </div>
        </Card>
      </div>

      <Card title="Calculatoare pornite" sub="Ce raportează agentul din turzx (pc_metrics) prin vmui." right={<button type="button" className="btn ghost sm" onClick={() => void metrics.refresh()}><RefreshCw className="size-3.5" /></button>}>
        {pcs.length === 0 ? <div className="text-sm text-dim">nimic raportat{metrics.error ? ` · ${metrics.error}` : ""}</div> : (
          <div className="grid grid-cols-2 gap-3">
            {pcs.map(([host, m]) => (
              <div key={host} className="rounded-xl border border-border p-3">
                <div className="flex items-baseline justify-between"><div className="font-medium">{host}</div><div className="text-xs text-muted">{m.uptime != null ? `up ${Math.floor(m.uptime / 3600)} h` : ""}</div></div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  {[["CPU", m.cpu], ["RAM", m.ram], ["GPU", m.gpu]].map(([k, v]) => (
                    <div key={String(k)}><div className="text-xs text-muted">{k}</div><div className="text-lg tabular-nums">{typeof v === "number" ? `${Math.round(v)} %` : "—"}</div></div>
                  ))}
                </div>
                {m.focus?.title && <div className="mt-2 text-xs text-muted truncate">{m.focus.proc} · {m.focus.title}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Aplicația">
        <Row label="Pornește cu Windows" hint="minimizată în tray (--hidden)">
          {auto == null ? <span className="text-xs text-dim">n/a</span> : <Switch checked={auto} onChange={(v) => void (v ? enable() : disable()).then(() => { setAuto(v); toast("ok", v ? "Pornire automată activată" : "Pornire automată dezactivată"); }).catch((e) => toast("error", String(e)))} />}
        </Row>
        <Row label="Repo" hint={info?.root ?? ""}><button type="button" className="btn ghost sm" onClick={() => void api.openPath("root")}><FolderOpen className="size-3.5" />Deschide</button></Row>
        <Row label="ambilight/settings.json"><button type="button" className="btn ghost sm" onClick={() => void api.openPath("settings")}><FolderOpen className="size-3.5" />Deschide</button></Row>
        <Row label="Versiune"><span className="text-xs text-muted">{info?.version ?? "—"}</span></Row>
      </Card>
    </div>
  );
}
