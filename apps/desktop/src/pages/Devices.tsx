import { invoke } from "@tauri-apps/api/core";
import { Check, Laptop, Smartphone, Trash2, X } from "lucide-react";
import * as React from "react";
import { api, cn, toast, useEvent } from "../lib";
import { usePlatform } from "../platform";
import { Card } from "../ui";

export type Device = { id: string; name: string; platform: string; status: string; approvedBy: string | null; lastSeenAt: string | null; lastIp: string | null; createdAt: string };
export type Pending = Device & { code: string };
export type DevicesPayload = { devices: Device[]; pending: Pending[]; version: number };

/** Both runtimes reach /api/devices differently: desktop with the shared
 *  token (devices_list/devices_op), mobile with its own device token (vmui_get/vmui_send). */
function useDevicesApi() {
  const { mobile } = usePlatform();
  return React.useMemo(
    () => ({
      list: () => (mobile ? api.vmuiGet<DevicesPayload>("/api/devices") : invoke<DevicesPayload>("devices_list")),
      op: async (body: { op: string; id: string; code?: string; name?: string }) => {
        if (mobile) {
          const r = await api.vmuiSend<{ ok: boolean; error?: string }>("POST", "/api/devices", body);
          if (!r.ok) throw new Error(r.error ?? "eroare");
        } else await invoke("devices_op", body);
      },
    }),
    [mobile],
  );
}

/** Pending-request banner for the top of every page; hides itself when there is nothing to approve. */
export function PendingBanner() {
  const { mobile } = usePlatform();
  const dev = useDevicesApi();
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  useEvent<DevicesPayload>("devices", (p) => setPending(p.pending));
  React.useEffect(() => {
    if (!mobile) return; // desktop gets pushed `devices` events from Rust
    const tick = () => dev.list().then((p) => setPending(p.pending)).catch(() => undefined);
    void tick();
    const id = setInterval(() => document.visibilityState === "visible" && void tick(), 5000);
    return () => clearInterval(id);
  }, [mobile, dev]);
  if (pending.length === 0) return null;
  const act = (p: Pending, op: "approve" | "reject") => {
    setBusy(p.id);
    dev.op(op === "approve" ? { op, id: p.id, code: p.code } : { op, id: p.id })
      .then(() => { toast("ok", op === "approve" ? `${p.name} aprobat` : "respins"); setPending((l) => l.filter((x) => x.id !== p.id)); })
      .catch((e) => toast("error", String(e)))
      .finally(() => setBusy(null));
  };
  return (
    <div className="grid gap-2 mb-4" role="status">
      {pending.map((p) => (
        <div key={p.id} className="glass flex items-center gap-3 border-warn/50 px-3 py-2.5">
          <Icon platform={p.platform} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{p.name} cere acces</div>
            <div className="text-xs text-muted">{p.platform} · {p.lastIp ?? "?"} · codul de pe ecranul lui trebuie să fie</div>
          </div>
          <div className="font-mono text-xl tabular-nums tracking-widest">{p.code}</div>
          <button type="button" className="btn primary sm" disabled={busy === p.id} onClick={() => act(p, "approve")}><Check className="size-4" />Aprobă</button>
          <button type="button" className="btn ghost sm" aria-label="Respinge" disabled={busy === p.id} onClick={() => act(p, "reject")}><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}

/** Full list with revoke, for the PC page (desktop) and the Pi page (mobile). */
export function DevicesCard() {
  const dev = useDevicesApi();
  const [data, setData] = React.useState<DevicesPayload | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const load = React.useCallback(() => dev.list().then(setData).catch(() => undefined), [dev]);
  React.useEffect(() => void load(), [load]);
  useEvent<DevicesPayload>("devices", setData);
  const approved = data?.devices.filter((d) => d.status === "approved") ?? [];
  return (
    <Card title="Dispozitive împerecheate" sub="Telefoane și PC-uri cu aplicația vmui. Fiecare are tokenul lui; revocă de aici.">
      {!data ? <div className="text-sm text-dim">se încarcă…</div> : approved.length === 0 ? <div className="text-sm text-dim">Niciun dispozitiv.</div> : (
        <div className="grid gap-2">
          {approved.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <Icon platform={d.platform} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{d.name}</div>
                <div className="text-xs text-muted truncate">{d.platform}{d.lastSeenAt ? ` · văzut ${ago(d.lastSeenAt)}` : ""}{d.lastIp ? ` · ${d.lastIp}` : ""}{d.approvedBy ? ` · ${d.approvedBy}` : ""}</div>
              </div>
              <button type="button" className={cn("btn ghost sm hover:text-down")} aria-label={`Revocă ${d.name}`} disabled={busy === d.id}
                onClick={() => { if (!confirm(`Revoci accesul pentru ${d.name}?`)) return; setBusy(d.id); dev.op({ op: "revoke", id: d.id }).then(() => { toast("ok", `${d.name} revocat`); void load(); }).catch((e) => toast("error", String(e))).finally(() => setBusy(null)); }}>
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function Icon({ platform }: { platform: string }) {
  return /android|ios/i.test(platform) ? <Smartphone className="size-5 text-muted" /> : <Laptop className="size-5 text-muted" />;
}
function ago(d: string): string {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return "acum";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} z`;
}
