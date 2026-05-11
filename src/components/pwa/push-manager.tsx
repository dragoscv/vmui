"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Loader2 } from "lucide-react";
import {
  getVapidPublicKeyAction,
  subscribePushAction,
  unsubscribePushAction,
  testPushAction,
} from "@/server/actions/push";
import { haptic } from "@/lib/haptics";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const norm = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(norm);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushManager() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [vapid, setVapid] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    void getVapidPublicKeyAction().then((r) => setVapid(r.key));
    void navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((s) => setEnabled(!!s)),
    );
  }, []);

  const enable = () =>
    start(async () => {
      if (!vapid) {
        toast.error("Push not configured (set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).");
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        toast.error("Notification permission denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const key = urlBase64ToUint8Array(vapid);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer,
      });
      const raw = sub.toJSON();
      const keys = raw.keys ?? {};
      const res = await subscribePushAction({
        endpoint: sub.endpoint,
        p256dh: keys.p256dh ?? "",
        authKey: keys.auth ?? "",
        topics: ["state", "builds", "alerts", "costs", "compliance"],
        userAgent: navigator.userAgent,
      });
      if (res.ok) {
        setEnabled(true);
        haptic("success");
        toast.success("Push notifications enabled");
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePushAction({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEnabled(false);
      haptic("tap");
      toast.success("Disabled");
    });

  const test = () =>
    start(async () => {
      const r = await testPushAction({ topics: ["state"] });
      if (r.ok && r.sent > 0) toast.success(`Sent to ${r.sent} device(s)`);
      else toast.error("No active subscriptions or VAPID not configured");
    });

  if (!supported) {
    return <p className="text-xs text-muted">Push not supported in this browser.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {enabled ? (
        <button
          type="button"
          onClick={disable}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface)] disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellOff className="h-3 w-3" />} Disable push
        </button>
      ) : (
        <button
          type="button"
          onClick={enable}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary-fg)] disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />} Enable push
        </button>
      )}
      {enabled && (
        <button
          type="button"
          onClick={test}
          disabled={pending}
          className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
        >
          Send test
        </button>
      )}
    </div>
  );
}
