import type { DeviceKind } from "@/lib/home/catalog";
import {
    Bluetooth,
    Cpu,
    DoorOpen,
    Lightbulb,
    Monitor,
    MonitorSmartphone,
    Radar,
    Snowflake,
    Sparkles, Stars,
    Thermometer,
    Tv,
    type LucideIcon,
} from "lucide-react";

export const KIND_ICON: Record<DeviceKind, LucideIcon> = {
  light: Lightbulb,
  strip: Sparkles,
  projector: Stars,
  ac: Snowflake,
  tv: Tv,
  display: MonitorSmartphone,
  monitor: Monitor,
  sensor: Thermometer,
  presence: Radar,
  door: DoorOpen,
  pc: Cpu,
  proxy: Bluetooth,
};

export const KIND_LABEL: Record<DeviceKind, string> = {
  light: "Light",
  strip: "LED strip",
  projector: "Projector",
  ac: "Air conditioner",
  tv: "TV",
  display: "Smart display",
  monitor: "Monitor",
  sensor: "Sensor",
  presence: "Presence",
  door: "Door",
  pc: "Computer",
  proxy: "Bluetooth proxy",
};
