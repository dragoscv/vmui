"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreVertical } from "lucide-react";
import type { InstanceMenuItemDescriptor } from "./instance-menu";

export function InstanceMenuButton({
  items,
  size = "icon",
}: {
  items: InstanceMenuItemDescriptor[];
  size?: "sm" | "icon";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label="More actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((it) => {
          if (it.kind === "separator") return <DropdownMenuSeparator key={it.key} />;
          if (it.kind === "label")
            return (
              <div
                key={it.key}
                className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted"
              >
                {it.label}
              </div>
            );
          const Icon = it.icon;
          return (
            <DropdownMenuItem
              key={it.key}
              disabled={it.disabled}
              danger={it.danger}
              onSelect={(e) => {
                e.preventDefault();
                it.onSelect();
              }}
            >
              <Icon className="h-4 w-4 opacity-80" />
              <span>{it.label}</span>
              {it.shortcut && (
                <span className="ml-auto text-[11px] tracking-widest text-muted">
                  {it.shortcut}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
