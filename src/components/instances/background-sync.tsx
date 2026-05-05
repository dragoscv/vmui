"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncAllAccounts } from "@/server/actions/instances";

/**
 * Mounts on the dashboard and polls all accounts every 15s in the background.
 * Re-runs only while document is visible to save AWS API calls.
 */
export function BackgroundSync({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [, start] = useTransition();
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      if (document.hidden || inFlight.current) return;
      inFlight.current = true;
      start(async () => {
        try {
          await syncAllAccounts();
          router.refresh();
        } catch {
          /* ignore — surfaced elsewhere */
        } finally {
          inFlight.current = false;
        }
      });
    };
    timer = setInterval(tick, 15_000);
    // Also kick once on mount after 1s
    const k = setTimeout(tick, 1_000);
    return () => {
      if (timer) clearInterval(timer);
      clearTimeout(k);
    };
  }, [enabled, router]);

  return null;
}
