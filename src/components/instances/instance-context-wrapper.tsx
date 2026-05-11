"use client";

import * as React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { InstanceMenuItemDescriptor } from "./instance-menu";

/**
 * Wraps children with a right-click / long-press (touch) context menu.
 * Radix's Context Menu primitive natively supports both interactions.
 */
export function InstanceContextMenuWrapper({
  items,
  children,
  asChild = true,
}: {
  items: InstanceMenuItemDescriptor[];
  children: React.ReactNode;
  asChild?: boolean;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild={asChild}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {items.map((it) => {
          if (it.kind === "separator") return <ContextMenuSeparator key={it.key} />;
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
            <ContextMenuItem
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
            </ContextMenuItem>
          );
        })}
      </ContextMenuContent>
    </ContextMenu>
  );
}
