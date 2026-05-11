"use client";

import { Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useVibe, VIBES, VIBE_LABEL, VIBE_DESCRIPTION, type Vibe } from "@/components/dashboard/vibe-provider";

const SWATCH: Record<Vibe, [string, string]> = {
  default: ["oklch(0.72 0.17 260)", "oklch(0.7 0.18 200)"],
  cyberpunk: ["oklch(0.78 0.20 340)", "oklch(0.80 0.15 195)"],
  cockpit: ["oklch(0.78 0.16 70)", "oklch(0.78 0.12 180)"],
  strategy: ["oklch(0.82 0.14 80)", "oklch(0.78 0.12 180)"],
  terminal: ["oklch(0.82 0.18 145)", "oklch(0.78 0.16 70)"],
  minimal: ["oklch(0.85 0.02 270)", "oklch(0.55 0.04 270)"],
  aurora: ["oklch(0.78 0.16 165)", "oklch(0.78 0.18 290)"],
  synthwave: ["oklch(0.80 0.20 340)", "oklch(0.82 0.16 60)"],
};

export function VibeSwitcher() {
  const { vibe, setVibe } = useVibe();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Switch dashboard vibe">
              <Palette className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Switch vibe</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Dashboard vibe</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {VIBES.map((v) => {
          const [a, b] = SWATCH[v];
          const active = vibe === v;
          return (
            <DropdownMenuItem
              key={v}
              onSelect={(e) => {
                e.preventDefault();
                setVibe(v);
              }}
              className="cursor-pointer"
            >
              <span
                className="mr-2 inline-block h-5 w-5 shrink-0 rounded-full ring-1 ring-[var(--color-border)]"
                style={{
                  background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
                }}
                aria-hidden
              />
              <span className="flex-1">
                <span className="block text-sm font-medium">{VIBE_LABEL[v]}</span>
                <span className="block text-[11px] text-muted">{VIBE_DESCRIPTION[v]}</span>
              </span>
              {active && <Check className="ml-2 h-4 w-4 shrink-0 text-[var(--color-primary)]" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
