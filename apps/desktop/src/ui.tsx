import * as React from "react";
import { cn } from "./lib";

export function Card({ title, sub, right, children, className }: { title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("glass p-5", className)}>
      {(title || right) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-dim mt-0.5">{hint}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

export function Slider({ value, min, max, step = 1, onChange, onCommit, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: (v: number) => void; format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-3 w-full">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--v": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
      <span className="w-14 text-right text-xs tabular-nums text-muted">{format ? format(value) : value}</span>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<{ id: T; label: string; icon?: React.ReactNode }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl p-1 gap-1 bg-bg-2 border border-border">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => onChange(o.id)} aria-pressed={o.id === value}
          className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors", o.id === value ? "bg-surface-2 text-fg border border-border" : "text-muted hover:text-fg")}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "ok" | "warn" | "down" }) {
  return (
    <div className="glass px-4 py-3">
      <div className="text-xs text-muted">{k}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "down" && "text-down")}>{v}</div>
    </div>
  );
}

export function Swatches({ value, onChange, colors }: { value: string; onChange: (hex: string) => void; colors: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c) => (
        <button key={c} type="button" aria-label={c} aria-pressed={value.toLowerCase() === c.toLowerCase()} onClick={() => onChange(c)}
          className={cn("size-7 rounded-full border-2 transition-transform", value.toLowerCase() === c.toLowerCase() ? "border-fg scale-110" : "border-transparent hover:scale-105")} style={{ background: c }} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 rounded-lg border border-border bg-transparent p-0.5" aria-label="Culoare personalizată" />
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-dim">{text}</div>;
}
