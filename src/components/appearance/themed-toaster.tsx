"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

/** Sonner follows the app theme (not just the OS) and uses our tokens. */
export function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="bottom-right"
      theme={resolvedTheme === "light" ? "light" : "dark"}
      richColors
      closeButton
      offset={16}
      mobileOffset={{ bottom: 88 }}
      toastOptions={{
        classNames: {
          toast: "!rounded-[var(--radius-lg)] !border-[var(--color-border)] !bg-[var(--color-surface)] !text-[var(--color-fg)] !shadow-[var(--shadow-md)]",
          description: "!text-[var(--color-fg-muted)]",
        },
      }}
    />
  );
}
