"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once on the client. Server actions and live
 * data still hit the network — the SW only caches the app shell + static
 * assets so the UI loads instantly and survives flaky local connections.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
