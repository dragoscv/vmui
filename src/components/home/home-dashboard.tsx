"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { HaState } from "@/lib/home/ha-client";
import { cn } from "@/lib/utils";
import type { PlacedDevice, WallSetting } from "@/server/queries/home";
import { DoorOpen, Droplets, Lightbulb, Radar, Thermometer } from "lucide-react";
import * as React from "react";
import { AmbilightPanel } from "./ambilight-panel";
import { KIND_ICON } from "./device-icon";
import { DeviceSheet } from "./device-sheet";
import { FloorPlan } from "./floor-plan";
import { cssColor, HomeStatesProvider, isOn, useEntity, useHomeStates } from "./use-home-states";

export function HomeDashboard({
  devices,
  initialStates,
  haUrl,
  initialTab = "plan",
  wall,
}: {
  devices: PlacedDevice[];
  initialStates: Record<string, HaState>;
  haUrl: string | null;
  initialTab?: "plan" | "devices" | "ambilight";
  wall: WallSetting;
}) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const device = devices.find((d) => d.id === selected) ?? null;

  return (
    <HomeStatesProvider initial={initialStates}>
      <div className="space-y-6">
        <Vitals />
        <Tabs defaultValue={initialTab}>
          <TabsList aria-label="Home views">
            <TabsTrigger value="plan">Floor plan</TabsTrigger>
            <TabsTrigger value="devices">Devices</TabsTrigger>
            <TabsTrigger value="ambilight">Ambilight</TabsTrigger>
          </TabsList>
          <TabsContent value="plan">
            <FloorPlan devices={devices} selected={selected} onSelect={setSelected} />
          </TabsContent>
          <TabsContent value="devices">
            <DeviceGrid devices={devices} onSelect={setSelected} />
          </TabsContent>
          <TabsContent value="ambilight">
            <AmbilightPanel wall={wall} />
          </TabsContent>
        </Tabs>
      </div>
      <DeviceSheet device={device} haUrl={haUrl} onClose={() => setSelected(null)} />
    </HomeStatesProvider>
  );
}

function Vitals() {
  const temp = useEntity("sensor.temperature_and_humidity_sensor_temperature");
  const hum = useEntity("sensor.temperature_and_humidity_sensor_humidity");
  const presence = useEntity("binary_sensor.human_presence_sensor_occupancy");
  const door = useEntity("binary_sensor.main_door_door");
  const { states } = useHomeStates();
  const lightsOn = Object.values(states).filter((s) => s.entity_id.startsWith("light.") && s.entity_id !== "light.hyperhdr" && isOn(s)).length;

  const items = [
    { icon: Thermometer, label: "Bedroom", value: temp ? `${Number(temp.state).toFixed(1)}°` : "—" },
    { icon: Droplets, label: "Humidity", value: hum ? `${Math.round(Number(hum.state))}%` : "—" },
    { icon: Radar, label: "Presence", value: presence ? (presence.state === "on" ? "here" : "away") : "—", warn: presence?.state === "on" },
    { icon: DoorOpen, label: "Main door", value: door ? (door.state === "on" ? "open" : "closed") : "—", warn: door?.state === "on" },
    { icon: Lightbulb, label: "Lights on", value: String(lightsOn) },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="surface flex items-center gap-2.5 px-3 py-2.5">
          <it.icon className={cn("h-4 w-4 shrink-0", it.warn ? "text-[var(--color-warning)]" : "text-muted")} />
          <div className="min-w-0">
            <p className="truncate text-[11px] uppercase tracking-wider text-muted">{it.label}</p>
            <p className="text-sm font-semibold tabular-nums">{it.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeviceGrid({ devices, onSelect }: { devices: PlacedDevice[]; onSelect: (id: string) => void }) {
  const rooms = ["bedroom", "living_room", "kitchen", "office"] as const;
  const names: Record<string, string> = { bedroom: "Bedroom", living_room: "Living Room", kitchen: "Kitchen", office: "Office" };
  return (
    <div className="space-y-6">
      {rooms.map((r) => {
        const list = devices.filter((d) => d.room === r);
        if (!list.length) return null;
        return (
          <section key={r} aria-label={names[r]} className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-muted">{names[r]}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((d) => (
                <DeviceTile key={d.id} device={d} onSelect={() => onSelect(d.id)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DeviceTile({ device, onSelect }: { device: PlacedDevice; onSelect: () => void }) {
  const s = useEntity(device.entity);
  const on = device.entity ? isOn(s) : device.id === "dxlight" || device.id === "pc";
  const color = cssColor(s);
  const Icon = KIND_ICON[device.kind];
  const sub =
    device.kind === "sensor" && s
      ? `${Number(s.state).toFixed(1)} ${String(s.attributes.unit_of_measurement ?? "")}`
      : device.kind === "ac" && s
        ? s.state === "off"
          ? "off"
          : `${s.state} · ${s.attributes.temperature ?? "?"}°`
        : device.kind === "presence" && s
          ? s.state === "on"
            ? "occupied"
            : "clear"
          : device.kind === "door" && s
            ? s.state === "on"
              ? "open"
              : "closed"
            : device.entity
              ? s
                ? s.state
                : "unavailable"
              : device.via;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="surface card-hover flex items-center gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors"
        style={{ background: on ? color ?? "var(--color-primary)" : "var(--color-bg-muted)", color: on ? "#0b0e16" : "var(--color-fg-muted)" }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{device.name}</span>
        <span className="block truncate text-xs text-muted">{sub}</span>
      </span>
    </button>
  );
}
