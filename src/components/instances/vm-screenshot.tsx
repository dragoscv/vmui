"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, MonitorOff } from "lucide-react";
import { getScreenshotAction } from "@/server/actions/screenshots";
import { cn } from "@/lib/utils";

/**
 * Live-ish screenshot for a local-kvm running VM. Polls
 * getScreenshotAction at the requested interval and paints the
 * decoded RGB buffer onto a <canvas>.
 *
 * Renders an aspect-ratio container so layout doesn't shift when the
 * first frame arrives; falls back to a poetic placeholder when the VM
 * is off or screenshots are unsupported (Hyper-V).
 */
export function VmScreenshot({
  accountId,
  enabled,
  intervalMs = 8000,
  maxWidth = 480,
  className,
}: {
  accountId: string;
  enabled: boolean;
  intervalMs?: number;
  maxWidth?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHasFrame(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await getScreenshotAction(accountId, maxWidth);
        if (cancelled) return;
        if (!r.ok) {
          setUnsupported(true);
          return;
        }
        if (r.width && r.height && r.rgbBase64) {
          paint(canvasRef.current, r.width, r.height, r.rgbBase64);
          setHasFrame(true);
        }
      } catch {
        /* ignore — next poll will retry */
      } finally {
        if (!cancelled) timer = setTimeout(tick, intervalMs);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accountId, enabled, intervalMs, maxWidth]);

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-muted)]",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "h-full w-full object-contain transition-opacity duration-500",
          hasFrame ? "opacity-100" : "opacity-0",
        )}
      />
      {!hasFrame && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted">
          {unsupported ? (
            <>
              <MonitorOff className="h-5 w-5" />
              <span className="text-[11px]">screenshots unavailable</span>
            </>
          ) : enabled ? (
            <>
              <Camera className="h-5 w-5 animate-pulse" />
              <span className="text-[11px]">capturing…</span>
            </>
          ) : (
            <>
              <MonitorOff className="h-5 w-5" />
              <span className="text-[11px]">VM is off</span>
            </>
          )}
        </div>
      )}
      {hasFrame && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--color-primary)] to-transparent opacity-60" />
      )}
    </div>
  );
}

function paint(canvas: HTMLCanvasElement | null, w: number, h: number, b64: string) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Decode base64 → bytes
  const bin = atob(b64);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; j < bin.length; i += 4, j += 3) {
    rgba[i] = bin.charCodeAt(j);
    rgba[i + 1] = bin.charCodeAt(j + 1);
    rgba[i + 2] = bin.charCodeAt(j + 2);
    rgba[i + 3] = 255;
  }
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const img = new ImageData(rgba, w, h);
  ctx.putImageData(img, 0, 0);
}
