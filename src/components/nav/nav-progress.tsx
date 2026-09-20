"use client";

import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

// Thin progress bar under the topbar during client navigations. Starts on any
// in-app <a> click (capture phase, before Next intercepts) and completes when
// the URL actually changes; a stalled navigation drains to 90 % and waits.
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = React.useState(false);
  const [width, setWidth] = React.useState(0);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const started = React.useRef<string>("");

  const stop = React.useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setWidth(100);
    const t = setTimeout(() => {
      setActive(false);
      setWidth(0);
    }, 220);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      const current = location.pathname + location.search;
      const next = url.pathname + url.search;
      if (next === current) return;
      started.current = next;
      setActive(true);
      setWidth(12);
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.12 : w)), 160);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  React.useEffect(() => {
    if (!active) return;
    return stop();
    // pathname/search changing means the navigation landed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[var(--z-toast)] h-0.5">
      <div
        className="h-full bg-[var(--color-primary)] shadow-[0_0_8px_var(--color-primary)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${width}%`, opacity: active ? 1 : 0 }}
      />
    </div>
  );
}
