"use client";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Bottom sheet on phones, right-hand panel from `md` up. One component, so a
 * device detail feels native on both without two code paths.
 */
export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string; description?: string }
>(({ className, children, title, description, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-[vmui-in_200ms_ease-out] data-[state=closed]:animate-[vmui-out_160ms_ease-in]" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "glass fixed z-50 flex flex-col gap-4 overflow-y-auto border-[var(--color-border)] p-5 shadow-2xl outline-none",
        "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-[var(--radius-xl)] border-t pb-[max(1.25rem,env(safe-area-inset-bottom))]",
        "md:inset-y-0 md:right-0 md:left-auto md:h-dvh md:max-h-none md:w-[420px] md:rounded-none md:rounded-l-[var(--radius-xl)] md:border-l md:border-t-0",
        "data-[state=open]:animate-[sheet-in_260ms_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[sheet-out_180ms_ease-in]",
        className,
      )}
      {...props}
    >
      <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-[color-mix(in_oklch,var(--color-fg)_20%,transparent)] md:hidden" aria-hidden />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <DialogPrimitive.Title className="truncate text-lg font-semibold tracking-tight">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="mt-0.5 text-sm text-muted">{description}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          )}
        </div>
        <DialogPrimitive.Close
          className="rounded-full p-1.5 text-muted transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </div>
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";
