import { invoke } from "@tauri-apps/api/core";
import { KeyRound, RadioTower, RefreshCw, Smartphone } from "lucide-react";
import * as React from "react";
import { cn, toast, type Health } from "../lib";

type Found = { url: string; host: string; via: string };
type Ticket = { id: string; token: string; code: string; status: string };
type Step = { kind: "scan" } | { kind: "pick"; found: Found[] } | { kind: "wait"; url: string; t: Ticket } | { kind: "login"; url: string };

/** First run on the phone. Finds vmui by itself (mDNS on the LAN, `homepi`
 *  over Tailscale), then either asks for approval — the code shows here and
 *  in the web / desktop / other phones — or signs in with the vmui account. */
export function Setup({ onDone, canCancel, onCancel }: { onDone: () => void; canCancel: boolean; onCancel: () => void }) {
  const [step, setStep] = React.useState<Step>({ kind: "scan" });
  const [manual, setManual] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const scan = React.useCallback(async () => {
    setStep({ kind: "scan" });
    const found = await invoke<Found[]>("discover").catch(() => [] as Found[]);
    setStep({ kind: "pick", found });
  }, []);
  React.useEffect(() => void scan(), [scan]);

  const request = async (url: string) => {
    setBusy(true);
    try {
      const t = await invoke<Ticket>("pair_request", { url });
      setStep({ kind: "wait", url, t });
      const h = await invoke<Health>("pair_wait", { url, id: t.id, token: t.token });
      toast("ok", `Aprobat · ${h.detail}`);
      onDone();
    } catch (e) {
      toast("error", String(e));
      setStep({ kind: "pick", found: [{ url, host: "", via: "manual" }] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-scene h-full grid place-items-center p-5" style={{ paddingTop: "max(env(safe-area-inset-top), 20px)" }}>
      <div className="glass w-full max-w-sm p-6 grid gap-5">
        <div className="flex items-center gap-3">
          <Smartphone className="size-7 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Conectare la casă</h1>
            <p className="text-xs text-muted">Telefonul găsește singur serverul; îl aprobi de pe web, PC sau alt telefon.</p>
          </div>
        </div>

        {step.kind === "scan" && (
          <div className="flex items-center gap-3 text-sm text-muted py-6 justify-center"><RadioTower className="size-5 animate-pulse text-primary" />caut vmui în rețea…</div>
        )}

        {step.kind === "pick" && (
          <div className="grid gap-3">
            {step.found.length === 0 && <p className="text-sm text-warn">Nu am găsit niciun vmui. Ești pe Wi-Fi-ul de acasă sau cu Tailscale pornit?</p>}
            {step.found.map((f) => (
              <button key={f.url} type="button" className="tile on text-left" disabled={busy} onClick={() => void request(f.url)}>
                <RadioTower className="size-5 text-ok" />
                <div className="min-w-0"><div className="font-medium">{f.host || "vmui"}</div><div className="text-xs text-muted truncate">{f.url} · {f.via === "mdns" ? "găsit în LAN" : f.via === "dns" ? "prin nume" : "manual"}</div></div>
              </button>
            ))}
            <div className="flex gap-2">
              <input className="input flex-1" inputMode="url" autoCapitalize="off" placeholder="sau http://adresa:3737" value={manual} onChange={(e) => setManual(e.target.value)} />
              <button type="button" className="btn" disabled={busy || !/^https?:\/\//.test(manual)} onClick={() => void request(manual.trim().replace(/\/$/, ""))}>OK</button>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button type="button" className="btn ghost sm" onClick={() => void scan()}><RefreshCw className="size-3.5" />caută din nou</button>
              <button type="button" className="btn ghost sm" disabled={step.found.length === 0 && !manual} onClick={() => setStep({ kind: "login", url: step.found[0]?.url ?? manual })}><KeyRound className="size-3.5" />am contul vmui</button>
            </div>
          </div>
        )}

        {step.kind === "wait" && (
          <div className="grid gap-4 text-center py-2">
            <p className="text-sm text-muted">Aprobă acest telefon din <b>vmui web → Displays</b>, din aplicația de pe PC sau de pe alt telefon. Codul trebuie să fie același:</p>
            <div className="font-mono text-5xl tabular-nums tracking-[0.35em] text-primary">{step.t.code}</div>
            <p className="text-xs text-dim">{step.url} · expiră în 10 minute</p>
            <button type="button" className="btn ghost sm justify-self-center" onClick={() => setStep({ kind: "login", url: step.url })}><KeyRound className="size-3.5" />sau conectează-te cu contul</button>
          </div>
        )}

        {step.kind === "login" && <Login url={step.url} onBack={() => void scan()} onDone={onDone} />}

        {canCancel && step.kind !== "wait" && <button type="button" className="btn ghost sm justify-self-end" onClick={onCancel}>Înapoi</button>}
      </div>
    </div>
  );
}

function Login({ url, onBack, onDone }: { url: string; onBack: () => void; onDone: () => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const h = await invoke<Health>("pair_login", { url, email, password });
      toast("ok", `Conectat · ${h.detail}`);
      onDone();
    } catch (e) {
      toast("error", String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void go(); }}>
      <p className="text-xs text-muted">Contul din vmui ({url}). Telefonul e aprobat pe loc.</p>
      <label className="field"><span>Email</span><input className="input" type="email" autoCapitalize="off" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field"><span>Parolă</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <div className="flex justify-between gap-2 pt-1">
        <button type="button" className="btn ghost" onClick={onBack}>Înapoi</button>
        <button type="submit" className={cn("btn primary")} disabled={busy || !email || !password}>{busy ? "Se verifică…" : "Conectează"}</button>
      </div>
    </form>
  );
}
