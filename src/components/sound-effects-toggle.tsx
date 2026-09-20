"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { soundsEnabled, setSoundsEnabled, sfx } from "@/lib/sfx";

export function SoundEffectsToggle() {
  const t = useTranslations("misc.sound");
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(soundsEnabled()); }, []);
  function toggle() {
    const next = !on;
    setOn(next);
    setSoundsEnabled(next);
    if (next) sfx.ok();
  }
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
      <input type="checkbox" checked={on} onChange={toggle} className="h-4 w-4 accent-[var(--color-success)] focus-visible:ring-2 focus-visible:ring-primary" />
      {t("label")}
    </label>
  );
}
