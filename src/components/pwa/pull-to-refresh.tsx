"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { haptic } from "@/lib/haptics";

const THRESHOLD = 80;

/**
 * Touch-driven pull-to-refresh wrapper. Re-triggers Next router.refresh() on
 * release past threshold; no-op on desktop and when the page isn't at scroll
 * top. Keeps the gesture out of the way of normal vertical scrolling.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [delta, setDelta] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0]?.clientY ?? null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current == null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      if (dy <= 0) {
        setDelta(0);
        return;
      }
      setDelta(Math.min(dy * 0.5, THRESHOLD * 1.4));
    };
    const onEnd = async () => {
      if (startY.current == null) return;
      const triggered = delta >= THRESHOLD;
      startY.current = null;
      setDelta(0);
      if (triggered) {
        haptic("confirm");
        setRefreshing(true);
        router.refresh();
        setTimeout(() => setRefreshing(false), 600);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [delta, router]);

  const progress = Math.min(delta / THRESHOLD, 1);
  const ready = delta >= THRESHOLD;

  return (
    <>
      <div
        className="pointer-events-none fixed left-1/2 top-2 z-40 -translate-x-1/2 rounded-full bg-[var(--color-surface)] p-2 shadow-lg transition-opacity md:hidden"
        style={{ opacity: delta > 4 || refreshing ? 1 : 0 }}
      >
        <RefreshCw
          className={`h-4 w-4 ${refreshing ? "animate-spin" : ready ? "text-[var(--color-primary)]" : "text-muted"}`}
          style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
        />
      </div>
      {children}
    </>
  );
}
