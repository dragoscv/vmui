"use client";

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
  import { useTranslations } from "next-intl";

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

export function useKindLabel(): (k: DeviceKind) => string {
  const t = useTranslations("homeCards.kinds");
  return (k) => t(k);
}
