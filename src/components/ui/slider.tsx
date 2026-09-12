"use client";
import { cn } from "@/lib/utils";
import * as React from "react";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> & {
  value: number;
  onChange: (value: number) => void;
  /** Called once the pointer is released — use it for network calls. */
  onCommit?: (value: number) => void;
  /** CSS gradient painted under the track (colour temperature, hue). */
  track?: string;
};

/**
 * Native range input, styled via `.vmui-range` from globals.css. Native is
 * deliberate: on a phone the browser's own thumb is the one the OS knows how
 * to grab, and it costs zero JS.
 */
export function Slider({ value, onChange, onCommit, track, className, style, ...props }: Props) {
  return (
    <input
      type="range"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={() => onCommit?.(value)}
      onKeyUp={(e) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) onCommit?.(value);
      }}
      onTouchEnd={() => onCommit?.(value)}
      className={cn("vmui-range w-full", className)}
      style={track ? { ...style, background: track } : style}
      {...props}
    />
  );
}
