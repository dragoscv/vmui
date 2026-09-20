"use client";

import { Alert, Button, Progress, Skeleton } from "@/components/ui";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

const CDN = "https://cdn.jsdelivr.net/npm/asciinema-player@3.7.0";

interface AsciinemaPlayer {
  play(): Promise<void> | void;
  pause(): Promise<void> | void;
  seek(pos: number): Promise<void> | void;
  getCurrentTime(): Promise<number> | number;
  getDuration(): Promise<number | null> | number | null;
  addEventListener(name: string, cb: () => void): void;
  dispose(): void;
}
interface AsciinemaModule {
  create(src: string, el: HTMLElement, opts: Record<string, unknown>): AsciinemaPlayer;
}

/** Loaded from the CDN at runtime; the module URL is hidden from the bundler on purpose. */
const loadModule = (): Promise<AsciinemaModule> => new Function("u", "return import(u)")(`${CDN}/+esm`) as Promise<AsciinemaModule>;

export function CastPlayer({ src, durationMs }: { src: string; durationMs: number }) {
  const t = useTranslations("observe.recordings.player");
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const playerRef = React.useRef<AsciinemaPlayer | null>(null);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const duration = Math.max(1, durationMs / 1000);

  React.useEffect(() => {
    let cancelled = false;
    if (!document.querySelector(`link[data-cast-css]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${CDN}/dist/bundle/asciinema-player.css`;
      link.dataset.castCss = "1";
      document.head.appendChild(link);
    }
    loadModule()
      .then((mod) => {
        if (cancelled || !hostRef.current) return;
        const p = mod.create(src, hostRef.current, { autoPlay: false, fit: "width", controls: false, theme: "monokai" });
        p.addEventListener("play", () => setPlaying(true));
        p.addEventListener("pause", () => setPlaying(false));
        p.addEventListener("ended", () => setPlaying(false));
        playerRef.current = p;
        setReady(true);
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [src]);

  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(async () => {
      const p = playerRef.current;
      if (!p) return;
      setTime(await p.getCurrentTime());
    }, 250);
    return () => clearInterval(id);
  }, [playing]);

  const seekTo = (sec: number) => {
    setTime(sec);
    void playerRef.current?.seek(sec);
  };

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const r = Math.floor(s % 60);
    return `${m}:${String(r).padStart(2, "0")}`;
  };

  if (error) {
    return <Alert tone="warning" title={t("loadFailed")}>{t("loadFailedHint")}</Alert>;
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-bg p-2">
        {!ready && <Skeleton className="absolute inset-2 rounded-[var(--radius-md)]" />}
        <div ref={hostRef} className={ready ? "" : "invisible min-h-64"} />
      </div>
      <div className="surface flex flex-wrap items-center gap-3 p-3">
        <Button size="icon" variant="secondary" aria-label={playing ? t("pause") : t("play")} disabled={!ready} onClick={() => void (playing ? playerRef.current?.pause() : playerRef.current?.play())}>
          {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
        </Button>
        <Button size="icon" variant="ghost" aria-label={t("restart")} disabled={!ready} onClick={() => seekTo(0)}>
          <RotateCcw className="size-4" aria-hidden />
        </Button>
        <span className="font-mono text-xs tabular-nums text-fg-muted">
          {fmt(time)} / {fmt(duration)}
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <input
            type="range"
            min={0}
            max={duration}
            step={0.25}
            value={Math.min(duration, time)}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label={t("scrub")}
            aria-valuetext={fmt(time)}
            disabled={!ready}
            className="w-full accent-[var(--color-primary)]"
          />
          <Progress value={(time / duration) * 100} size="sm" className="mt-1" />
        </div>
      </div>
    </div>
  );
}
