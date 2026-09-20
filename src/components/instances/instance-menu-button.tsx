"use client";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import type { InstanceMenuItemDescriptor } from "./instance-menu";

export function InstanceMenuButton({
  items,
  size = "icon",
}: {
  items: InstanceMenuItemDescriptor[];
  size?: "sm" | "icon";
}) {
  const t = useTranslations("vm.menu");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={t("moreActions")}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
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
              <Icon className="h-4 w-4 opacity-80" aria-hidden />
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
