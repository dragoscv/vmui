"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Laptop, Smartphone, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

type Device = { id: string; name: string; platform: string; status: string; approvedBy: string | null; lastSeenAt: string | Date | null; lastIp: string | null; createdAt: string | Date };
type Pending = Device & { code: string };
type Payload = { devices: Device[]; pending: Pending[]; version: number };

/** Phones and desktops paired with vmui. Long-polls /api/devices so a new
 *  pairing request pops up here (and as a toast) within a second. */
export function PairedDevicesCard() {
  const [data, setData] = React.useState<Payload | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const announced = React.useRef(new Set<string>());

  React.useEffect(() => {
    let alive = true;
    let version: number | undefined;
    const loop = async () => {
      while (alive) {
        try {
          const r = await fetch(`/api/devices${version === undefined ? "" : `?since=${version}`}`, { cache: "no-store" });
          if (!r.ok) throw new Error(String(r.status));
          const j = (await r.json()) as Payload;
          if (!alive) return;
          version = j.version;
          setData(j);
          for (const p of j.pending) {
            if (!announced.current.has(p.id)) {
              announced.current.add(p.id);
              toast(`Dispozitiv nou: ${p.name}`, { description: `Cod ${p.code} · aprobă din tab-ul Displays`, duration: 15000 });
            }
          }
        } catch {
          await new Promise((res) => setTimeout(res, 5000));
        }
      }
    };
    void loop();
    return () => { alive = false; };
  }, []);

  const op = async (body: Record<string, unknown>, okMsg: string) => {
    setBusy(String(body.id));
    try {
      const r = await fetch("/api/devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "eroare");
      toast.success(okMsg);
    } catch (e) {
      toast.error(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(null);
    }
  };

  const approved = data?.devices.filter((d) => d.status === "approved") ?? [];
  const revoked = data?.devices.filter((d) => d.status === "revoked") ?? [];
  return (
    <section className="rounded-2xl border border-border/60 bg-card/60 p-5 backdrop-blur">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Dispozitive împerecheate</h2>
          <p className="text-sm text-muted-foreground">Telefoane și PC-uri cu aplicația vmui. Fiecare are tokenul lui, revocabil aici.</p>
        </div>
        {data && data.pending.length > 0 && <Badge variant="warning">{data.pending.length} în așteptare</Badge>}
      </header>

      {data?.pending.map((p) => (
        <div key={p.id} className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3" role="status">
          <Icon platform={p.platform} />
          <div className="min-w-0 flex-1">
            <div className="font-medium">{p.name} <span className="text-muted-foreground">· {p.platform}</span></div>
            <div className="text-xs text-muted-foreground">cere acces din {p.lastIp ?? "?"} · verifică pe dispozitiv că afișează codul</div>
          </div>
          <div className="font-mono text-2xl tabular-nums tracking-widest">{p.code}</div>
          <Button size="sm" disabled={busy === p.id} onClick={() => void op({ op: "approve", id: p.id, code: p.code }, `${p.name} aprobat`)}><Check className="mr-1 size-4" />Aprobă</Button>
          <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => void op({ op: "reject", id: p.id }, "Cerere respinsă")}><X className="size-4" /></Button>
        </div>
      ))}

      {!data ? (
        <p className="text-sm text-muted-foreground">se încarcă…</p>
      ) : approved.length === 0 && data.pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">Niciun dispozitiv încă. Deschide aplicația pe telefon: găsește Pi-ul singură și cererea apare aici.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {approved.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <Icon platform={d.platform} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">{d.platform} · {d.lastSeenAt ? `văzut ${ago(d.lastSeenAt)}` : "nefolosit"}{d.lastIp ? ` · ${d.lastIp}` : ""}{d.approvedBy ? ` · aprobat de ${d.approvedBy}` : ""}</div>
              </div>
              <Button size="sm" variant="ghost" aria-label={`Revocă ${d.name}`} disabled={busy === d.id} onClick={() => { if (confirm(`Revoci accesul pentru ${d.name}?`)) void op({ op: "revoke", id: d.id }, `${d.name} revocat`); }}><Trash2 className="size-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      {revoked.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{revoked.length} revocate</p>}
    </section>
  );
}

function Icon({ platform }: { platform: string }) {
  return /android|ios|iphone/i.test(platform) ? <Smartphone className="size-5 text-muted-foreground" /> : <Laptop className="size-5 text-muted-foreground" />;
}

function ago(d: string | Date): string {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return "acum";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} z`;
}
