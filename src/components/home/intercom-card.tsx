"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { armIntercomAction, ignoreIntercomAction, openIntercomAction } from "@/server/actions/intercom";
import { BellRing, DoorOpen, PackageCheck, ShieldOff } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

export interface IntercomCardState {
  ringing: boolean;
  ringingSince: number | null;
  lastRingAt: number | null;
  lastOpenAt: number | null;
  autoOpenUntil: number | null;
  log: Array<{ at: number; event: string; by: string }>;
}

const EVENT_RO: Record<string, string> = { ring: "a sunat", end: "apel încheiat", opened: "ușa deschisă", armed: "auto-deschidere pornită", disarmed: "auto-deschidere oprită" };

function ago(ms: number | null, now: number): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return new Date(ms).toLocaleDateString("ro-RO");
}

/** Electra IA02 intercom on the office ESP32: live call state, one-tap open,
 *  and the courier/guest auto-open arm with an expiry. Polls the state every
 *  3 s while mounted so a ring shows up without a reload. */
export function IntercomCard({ initial, token }: { initial: IntercomCardState; token: string }) {
  const [s, setS] = React.useState(initial);
  const [now, setNow] = React.useState(() => Date.now());
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const tick = async () => {
      setNow(Date.now());
      try {
        const r = await fetch(`/api/esp/intercom?k=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (r.ok) setS((await r.json()) as IntercomCardState);
      } catch {
        /* offline; keep last */
      }
    };
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [token]);

  const armed = (s.autoOpenUntil ?? 0) > now;
  const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (r.ok) toast.success(label);
    else toast.error(r.error ?? "eșuat");
  };

  return (
    <Card className={s.ringing ? "ring-2 ring-[var(--color-warning)]" : undefined}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BellRing className={s.ringing ? "size-4 animate-pulse text-[var(--color-warning)]" : "size-4 text-muted"} aria-hidden />
            Interfon
          </CardTitle>
          <CardDescription>Electra IA02 · sonerie pe telefon, deschidere de la distanță</CardDescription>
        </div>
        {s.ringing ? <Badge variant="warning">sună acum</Badge> : armed ? <Badge variant="success">auto-deschidere {ago(s.autoOpenUntil, now).replace(/^/, "încă ")}</Badge> : <Badge variant="muted">liniște</Badge>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button disabled={!s.ringing || busy} onClick={() => run("Deschid ușa", openIntercomAction)}>
            <DoorOpen className="size-4" aria-hidden /> Răspunde și deschide
          </Button>
          <Button variant="secondary" disabled={!s.ringing || busy} onClick={() => run("Ignorat", ignoreIntercomAction)}>
            Ignoră
          </Button>
          {armed ? (
            <Button variant="ghost" disabled={busy} onClick={() => run("Auto-deschidere oprită", () => armIntercomAction(0))}>
              <ShieldOff className="size-4" aria-hidden /> Oprește auto-deschiderea
            </Button>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => run("Deschide automat 30 min", () => armIntercomAction(30))}>
                <PackageCheck className="size-4" aria-hidden /> Aștept curier · 30 min
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => run("Deschide automat 60 min", () => armIntercomAction(60))}>
                60 min
              </Button>
            </>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div className="surface px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-muted">Ultimul apel</dt>
            <dd className="font-semibold tabular-nums">{ago(s.lastRingAt, now)}</dd>
          </div>
          <div className="surface px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-muted">Ultima deschidere</dt>
            <dd className="font-semibold tabular-nums">{ago(s.lastOpenAt, now)}</dd>
          </div>
          <div className="surface px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wider text-muted">Auto-deschidere</dt>
            <dd className="font-semibold tabular-nums">{armed ? `până la ${new Date(s.autoOpenUntil!).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}` : "oprită"}</dd>
          </div>
        </dl>
        {s.log.length > 0 && (
          <ul className="divide-y divide-[var(--color-border)] text-sm">
            {s.log.slice(0, 8).map((e) => (
              <li key={`${e.at}-${e.event}`} className="flex items-center justify-between py-1.5">
                <span>
                  {EVENT_RO[e.event] ?? e.event} <span className="text-muted">· {e.by}</span>
                </span>
                <time className="tabular-nums text-muted" dateTime={new Date(e.at).toISOString()}>
                  {new Date(e.at).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}
                </time>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Deschiderea funcționează doar cât timp sună (linia AVP e alimentată numai în apel). Fiecare deschidere e în jurnalul de audit.</p>
      </CardContent>
    </Card>
  );
}
