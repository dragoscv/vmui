"use client";

import { Button } from "@/components/ui/button";
import { ROOMS, type CatalogDevice, type RoomId } from "@/lib/home/catalog";
import { cn } from "@/lib/utils";
import { placeDeviceAction, resetLayoutAction } from "@/server/actions/home";
import type { PlacedDevice } from "@/server/queries/home";
import { Lock, LockOpen, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
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
export function FloorPlan({ devices, selected, onSelect }: Props) {
  const [arrange, setArrange] = React.useState(false);
  const [local, setLocal] = React.useState(devices);
  const planRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setLocal(devices), [devices]);

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
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {arrange ? "Drag a device to where it really sits. Drops save automatically." : "Tap a device to control it."}
        </p>
        <div className="flex items-center gap-1">
          {arrange && (
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const r = await resetLayoutAction();
                r.ok ? toast.success("Layout reset to defaults") : toast.error(r.error);
              }}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
            </Button>
          )}
          <Button variant={arrange ? "primary" : "outline"} size="sm" onClick={() => setArrange((v) => !v)} aria-pressed={arrange}>
            {arrange ? <LockOpen className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
            {arrange ? "Done" : "Arrange"}
          </Button>
        </div>
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
            onSelect={() => onSelect(d.id)}
            onDrop={(x, y) => drop(d, x, y)}
          />
        ))}
      </div>
    </div>
  );
}

function Room({ room, devices }: { room: (typeof ROOMS)[number]; devices: PlacedDevice[] }) {
  // Room tint = blend of the lights that are on inside it; that is what a
  // room actually looks like from the doorway.
  const lit = devices.filter((d) => d.kind === "light" || d.kind === "strip" || d.kind === "projector");
  return (
    <div
      className="absolute rounded-[var(--radius-lg)] border border-[color-mix(in_oklch,var(--color-fg)_14%,transparent)] bg-[color-mix(in_oklch,var(--color-surface)_55%,transparent)]"
      style={{ left: `${room.x}%`, top: `${room.y}%`, width: `${room.w}%`, height: `${room.h}%` }}
    >
      <RoomTint devices={lit} />
      <span className="absolute left-2 top-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted sm:text-[11px]">{room.name}</span>
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
  onSelect,
  onDrop,
}: {
  device: PlacedDevice;
  selected: boolean;
  arrange: boolean;
  onSelect: () => void;
  onDrop: (clientX: number, clientY: number) => void;
}) {
  const room = ROOMS.find((r) => r.id === (device.room as RoomId))!;
  const left = room.x + (device.x / 100) * room.w;
  const top = room.y + (device.y / 100) * room.h;
  const s = useEntity(device.entity);
  const on = device.entity ? isOn(s) : device.id === "dxlight" || device.id === "pc";
  const color = cssColor(s);
  const Icon = KIND_ICON[device.kind];
  const value =
    device.kind === "sensor" && s ? `${Number(s.state).toFixed(1)}°` : device.kind === "ac" && s && s.state !== "off" ? `${s.attributes.temperature ?? ""}°` : null;

  return (
    <motion.button
      type="button"
      drag={arrange}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={(_, info) => onDrop(info.point.x, info.point.y)}
      onClick={() => !arrange && onSelect()}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      aria-label={`${device.name}${s ? `, ${s.state}` : ""}`}
      aria-pressed={selected}
      className={cn(
        "absolute z-10 flex items-center gap-1 rounded-full border px-1.5 py-1 shadow-md backdrop-blur-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]",
        // Centre with margins, not translate: motion owns `transform` for drag/tap.
        "-ml-[19px] -mt-[17px] sm:-ml-[21px] sm:-mt-[19px]",
        arrange ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        selected
          ? "border-[var(--color-primary)] bg-[var(--color-surface)]"
          : "border-[color-mix(in_oklch,var(--color-fg)_16%,transparent)] bg-[color-mix(in_oklch,var(--color-surface)_88%,transparent)] hover:border-[var(--color-primary)]",
      )}
      style={{ left: `${left}%`, top: `${top}%` }}
    >
      <span
        className="grid h-6 w-6 place-items-center rounded-full transition-colors sm:h-7 sm:w-7"
        style={{ background: on ? color ?? "var(--color-primary)" : "var(--color-bg-muted)", color: on ? "#0b0e16" : "var(--color-fg-muted)" }}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
      </span>
      {value && <span className="pr-1 text-[11px] font-medium tabular-nums">{value}</span>}
    </motion.button>
  );
}
