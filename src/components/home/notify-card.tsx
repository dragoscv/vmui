"use client";

import { Button } from "@/components/ui/button";
import { AppWindow, BatteryWarning, BellOff, BellRing, Bot, Check, Cpu, DoorOpen, GlassWater, Info, Monitor, Radar, Smartphone, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

type Action = { id: string; label: string; style: "primary" | "danger" | "ghost"; url?: string };
export type NotifyCard = {
  id: string; kind: string; title: string; body: string; subtitle: string | null; color: string | null; image: string | null;
  priority: "low" | "default" | "high" | "urgent"; progress: number | null; actions: Action[]; url: string | null; sticky: boolean;
  readAt: string | null; dismissedAt: string | null; createdAt: string; updatedAt: string;
};

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  copilot: Bot, agents: Bot, intercom: BellRing, pairing: Smartphone, water: GlassWater, pc: Monitor, pi: Cpu, door: DoorOpen, window: AppWindow, presence: Radar, battery: BatteryWarning, system: Info,
};

/** Live view of the notification centre (SSE /api/notify/stream). Every card
 *  has the same buttons the phone shows; a new high-priority card also pops a
 *  sonner toast so it is seen from any tab. */
export function NotifyCenterCard() {
  const [cards, setCards] = React.useState<NotifyCard[]>([]);
  const seen = React.useRef(new Set<string>());
  React.useEffect(() => {
    const es = new EventSource("/api/notify/stream");
    es.addEventListener("snapshot", (e) => {
      const j = JSON.parse((e as MessageEvent).data) as { cards: NotifyCard[] };
      setCards(j.cards);
      for (const c of j.cards) seen.current.add(c.id);
    });
    es.addEventListener("upsert", (e) => {
      const c = JSON.parse((e as MessageEvent).data) as NotifyCard;
      setCards((l) => [c, ...l.filter((x) => x.id !== c.id)]);
      if (!seen.current.has(c.id) && (c.priority === "high" || c.priority === "urgent")) {
        seen.current.add(c.id);
        toast(c.title, { description: c.body || c.subtitle || undefined, duration: c.priority === "urgent" ? 30000 : 10000 });
      }
    });
    es.addEventListener("dismiss", (e) => {
      const c = JSON.parse((e as MessageEvent).data) as NotifyCard;
      setCards((l) => l.filter((x) => x.id !== c.id));
    });
    return () => es.close();
  }, []);

  const act = async (c: NotifyCard, a: Action) => {
    if (a.url) {
      void fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "read", ids: [c.id] }) });
      window.location.href = a.url;
      return;
    }
    const r = await fetch("/api/notify/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c.id, action: a.id }) });
    const j = (await r.json()) as { ok: boolean; message?: string; error?: string };
    if (j.ok) toast.success(j.message ?? "gata"); else toast.error(j.error ?? "nu a mers");
  };
  const dismiss = (id: string) => fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "dismiss", id }) });

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
      <header className="mb-3 flex items-center gap-2">
        <div>
          <h2 className="text-sm font-semibold">Notificări</h2>
          <p className="text-xs text-muted-foreground">Ce a ajuns pe telefon și pe PC. Butoanele fac același lucru ca acolo.</p>
        </div>
        {cards.some((c) => !c.sticky) && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "dismissAll" }) })}>
            <Trash2 className="size-3.5" /> Curăță
          </Button>
        )}
      </header>
      {cards.length === 0 ? (
        <div className="grid place-items-center gap-1.5 py-8 text-muted-foreground">
          <BellOff className="size-6 opacity-50" />
          <div className="text-xs">Nimic activ.</div>
        </div>
      ) : (
        <ul className="grid gap-2">
          {cards.map((c) => {
            const color = c.color ?? "#94a3b8";
            const I = ICON[c.kind] ?? Info;
            return (
              <li key={c.id} className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20" style={{ borderLeft: `3px solid ${color}` }}>
                {c.image && <img src={c.image} alt="" className="h-28 w-full object-cover opacity-80" />}
                <div className="flex gap-3 p-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `${color}22`, color }}><I className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <div className="truncate text-sm font-medium">{c.title}</div>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{new Date(c.updatedAt).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    {c.subtitle && <div className="text-xs" style={{ color }}>{c.subtitle}</div>}
                    {c.body && <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground line-clamp-3">{c.body}</p>}
                    {c.progress != null && <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full" style={{ width: `${c.progress}%`, background: color }} /></div>}
                    {(c.actions.length > 0 || !c.sticky) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.actions.map((a) => (
                          <Button key={a.id} size="sm" variant={a.style} onClick={() => act(c, a)}>
                            {a.id === "approve" && <Check className="size-3.5" />}
                            {a.id === "reject" && <X className="size-3.5" />}
                            {a.label}
                          </Button>
                        ))}
                        {!c.sticky && <Button size="sm" variant="ghost" className="ml-auto" aria-label="Închide" onClick={() => dismiss(c.id)}><X className="size-3.5" /></Button>}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
