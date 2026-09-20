"use client";

import { Button } from "@/components/ui/button";
import { ROOMS, type CatalogDevice, type RoomId } from "@/lib/home/catalog";
import { cn } from "@/lib/utils";
import { placeDeviceAction, resetLayoutAction } from "@/server/actions/home";
import type { PlacedDevice } from "@/server/queries/home";
import { Lock, LockOpen, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { toast } from "sonner";
import { KIND_ICON } from "./device-icon";
import { cssColor, isOn, useEntity } from "./use-home-states";

type Props = {
  devices: PlacedDevice[];
  selected: string | null;
  onSelect: (id: string) => void;
};

/**
 * Top-down plan. Rooms are boxes in percent of the plan; devices are dots in
 * percent of their room. Drag a dot to move it (arrange mode); the drop is
 * persisted through placeDeviceAction and echoed back on refresh.
 */
export function FloorPlan({ devices, selected, onSelect, canArrange = true }: Props & { canArrange?: boolean }) {
  const t = useTranslations("homeCards.floorPlan");
  const [arrange, setArrange] = React.useState(false);
  const [local, setLocal] = React.useState(devices);
  const planRef = React.useRef<HTMLDivElement>(null);
  const [planSize, setPlanSize] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => setLocal(devices), [devices]);
  React.useEffect(() => {
    const el = planRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setPlanSize((p) => (p.w === r.width && p.h === r.height ? p : { w: r.width, h: r.height }));
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const offsets = React.useMemo(() => collisionOffsets(local, planSize), [local, planSize]);

  const drop = async (d: CatalogDevice, clientX: number, clientY: number) => {
    const plan = planRef.current?.getBoundingClientRect();
    if (!plan) return;
    const px = ((clientX - plan.left) / plan.width) * 100;
    const py = ((clientY - plan.top) / plan.height) * 100;
    const room = ROOMS.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) ?? ROOMS.find((r) => r.id === d.room)!;
    const x = Math.min(96, Math.max(4, ((px - room.x) / room.w) * 100));
    const y = Math.min(94, Math.max(6, ((py - room.y) / room.h) * 100));
    setLocal((prev) => prev.map((p) => (p.id === d.id ? { ...p, room: room.id, x, y, placed: true } : p)));
    const r = await placeDeviceAction({ deviceId: d.id, room: room.id, x, y });
    if (!r.ok) toast.error(r.error);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted">{arrange ? t("hintArrange") : t("hintTap")}</p>
        {canArrange && <div className="flex shrink-0 items-center gap-1">
          {arrange && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const r = await resetLayoutAction();
                r.ok ? toast.success(t("layoutReset")) : toast.error(r.error);
              }}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> {t("reset")}
            </Button>
          )}
          <Button variant={arrange ? "primary" : "outline"} size="sm" onClick={() => setArrange((v) => !v)} aria-pressed={arrange}>
            {arrange ? <LockOpen className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
            {arrange ? t("done") : t("arrange")}
          </Button>
        </div>}
      </div>

      <div
        ref={planRef}
        className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[color-mix(in_oklch,var(--color-bg-muted)_60%,transparent)] sm:aspect-[16/10]"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in oklch, var(--color-fg) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in oklch, var(--color-fg) 4%, transparent) 1px, transparent 1px)",
          backgroundSize: "5% 6.6667%",
        }}
      >
        {ROOMS.map((room) => (
          <Room key={room.id} room={room} devices={local.filter((d) => d.room === room.id)} />
        ))}

        {local.map((d) => (
          <DeviceDot
            key={d.id}
            device={d}
            selected={selected === d.id}
            arrange={arrange}
            offset={offsets.get(d.id) ?? ZERO}
            onSelect={() => onSelect(d.id)}
            onDrop={(x, y) => drop(d, x, y)}
          />
        ))}
      </div>
    </div>
  );
}

// Rendered pill size incl. the value badge; two dots overlap when both axes are closer than this.
const DOT_W_PX = 46;
const DOT_H_PX = 36;
const ZERO = { dx: 0, dy: 0 };
// Candidate slots around the true position, nearest first: below, above, sides, diagonals, then a second ring.
const SLOTS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: 1 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
  { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: -1 },
  { dx: 0, dy: 2 }, { dx: 0, dy: -2 }, { dx: 2, dy: 0 }, { dx: -2, dy: 0 },
  { dx: 1, dy: 2 }, { dx: -1, dy: 2 }, { dx: 1, dy: -2 }, { dx: -1, dy: -2 },
  { dx: 2, dy: 1 }, { dx: -2, dy: 1 }, { dx: 2, dy: -1 }, { dx: -2, dy: -1 },
  { dx: 0, dy: 3 }, { dx: 0, dy: -3 }, { dx: 2, dy: 2 }, { dx: -2, dy: 2 },
];

function dotCenter(d: PlacedDevice) {
  const room = ROOMS.find((r) => r.id === (d.room as RoomId)) ?? ROOMS[0]!;
  return { left: room.x + (d.x / 100) * room.w, top: room.y + (d.y / 100) * room.h };
}

// Walk dots in a fixed order (top-left first, id as tie-break); a dot whose
// pill would overlap an already-placed one takes the nearest free slot around
// its true position that stays inside the plan, or the least-crowded one when
// the room is denser than the plan can show. Deterministic, so a re-render
// never moves a dot that did not need moving.
function collisionOffsets(devices: PlacedDevice[], plan: { w: number; h: number }): Map<string, { dx: number; dy: number }> {
  const out = new Map<string, { dx: number; dy: number }>();
  if (plan.w === 0 || plan.h === 0) return out;
  const placed: Array<{ x: number; y: number }> = [];
  const sorted = devices
    .map((d) => ({ id: d.id, ...dotCenter(d) }))
    .sort((a, b) => a.top - b.top || a.left - b.left || a.id.localeCompare(b.id));
  const crowding = (x: number, y: number) =>
    placed.reduce((acc, p) => {
      const ox = DOT_W_PX - Math.abs(p.x - x);
      const oy = DOT_H_PX - Math.abs(p.y - y);
      return ox > 0 && oy > 0 ? acc + ox * oy : acc;
    }, 0);
  const inside = (x: number, y: number) => x >= DOT_W_PX / 2 && x <= plan.w - DOT_W_PX / 2 && y >= DOT_H_PX / 2 && y <= plan.h - DOT_H_PX / 2;
  for (const d of sorted) {
    const x0 = (d.left / 100) * plan.w;
    const y0 = (d.top / 100) * plan.h;
    let best = { dx: 0, dy: 0, score: crowding(x0, y0) };
    if (best.score > 0) {
      for (const s of SLOTS) {
        const dx = s.dx * DOT_W_PX;
        const dy = s.dy * DOT_H_PX;
        if (!inside(x0 + dx, y0 + dy)) continue;
        const score = crowding(x0 + dx, y0 + dy);
        if (score < best.score) best = { dx, dy, score };
        if (score === 0) break;
      }
    }
    placed.push({ x: x0 + best.dx, y: y0 + best.dy });
    if (best.dx !== 0 || best.dy !== 0) out.set(d.id, { dx: best.dx, dy: best.dy });
  }
  return out;
}

function Room({ room, devices }: { room: (typeof ROOMS)[number]; devices: PlacedDevice[] }) {
  const t = useTranslations("homeCards.floorPlan.rooms");
  // Room tint = blend of the lights that are on inside it; that is what a
  // room actually looks like from the doorway.
  const lit = devices.filter((d) => d.kind === "light" || d.kind === "strip" || d.kind === "projector");
  return (
    <div
      className="absolute rounded-[var(--radius-lg)] border border-[color-mix(in_oklch,var(--color-fg)_14%,transparent)] bg-[color-mix(in_oklch,var(--color-surface)_55%,transparent)]"
      style={{ left: `${room.x}%`, top: `${room.y}%`, width: `${room.w}%`, height: `${room.h}%` }}
    >
      <RoomTint devices={lit} />
      <span className="absolute left-2 top-1.5 truncate text-xs font-medium uppercase tracking-[0.14em] text-muted">{t(room.id)}</span>
    </div>
  );
}

function RoomTint({ devices }: { devices: PlacedDevice[] }) {
  return (
    <>
      {devices.map((d) => (
        <LightGlow key={d.id} device={d} />
      ))}
    </>
  );
}

function LightGlow({ device }: { device: PlacedDevice }) {
  const s = useEntity(device.entity);
  const color = device.entity ? cssColor(s) : device.id === "dxlight" ? "oklch(0.75 0.15 250)" : null;
  if (!color) return null;
  return (
    <span
      aria-hidden
      className="motion-safe-only pointer-events-none absolute rounded-full blur-2xl"
      style={{
        left: `${device.x}%`,
        top: `${device.y}%`,
        width: device.kind === "strip" ? "55%" : "38%",
        height: device.kind === "strip" ? "55%" : "38%",
        transform: "translate(-50%, -50%)",
        background: color,
        animation: "glow-breathe 4s ease-in-out infinite",
      }}
    />
  );
}

function DeviceDot({
  device,
  selected,
  arrange,
  offset,
  onSelect,
  onDrop,
}: {
  device: PlacedDevice;
  selected: boolean;
  arrange: boolean;
  offset: { dx: number; dy: number };
  onSelect: () => void;
  onDrop: (clientX: number, clientY: number) => void;
}) {
  const { left, top } = dotCenter(device);
  const [hover, setHover] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  const s = useEntity(device.entity);
  const on = device.entity ? isOn(s) : device.id === "dxlight" || device.id === "pc";
  const color = cssColor(s);
  const Icon = KIND_ICON[device.kind];
  const value =
    device.kind === "sensor" && s ? `${Number(s.state).toFixed(1)}°` : device.kind === "ac" && s && s.state !== "off" ? `${s.attributes.temperature ?? ""}°` : null;
  const showLabel = hover || focus || selected;

  return (
    <motion.button
      type="button"
      drag={arrange}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={(_, info) => onDrop(info.point.x, info.point.y)}
      onClick={() => !arrange && onSelect()}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      aria-label={`${device.name}${s ? `, ${s.state}` : ""}`}
      aria-pressed={selected}
      className={cn(
        "absolute flex items-center gap-1 rounded-full border px-1.5 py-1 shadow-md backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
        showLabel ? "z-20" : "z-10",
        // Centre with margins, not translate: motion owns `transform` for drag/tap.
        "-ml-[19px] -mt-[17px] sm:-ml-[21px] sm:-mt-[19px]",
        arrange ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        selected
          ? "border-[var(--color-primary)] bg-[var(--color-surface)]"
          : "border-[color-mix(in_oklch,var(--color-fg)_16%,transparent)] bg-[color-mix(in_oklch,var(--color-surface)_88%,transparent)] hover:border-[var(--color-primary)]",
      )}
      style={{
        left: offset.dx ? `calc(${left}% + ${offset.dx}px)` : `${left}%`,
        top: offset.dy ? `calc(${top}% + ${offset.dy}px)` : `${top}%`,
      }}
    >
      {showLabel && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] shadow"
        >
          {device.name}
        </span>
      )}
      <span
        className="grid h-6 w-6 place-items-center rounded-full transition-colors sm:h-7 sm:w-7"
        style={{ background: on ? color ?? "var(--color-primary)" : "var(--color-bg-muted)", color: on ? "#0b0e16" : "var(--color-fg-muted)" }}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
      </span>
      {value && <span className="pr-1 text-xs font-medium tabular-nums">{value}</span>}
    </motion.button>
  );
}
