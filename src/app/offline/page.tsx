export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">🛰️</div>
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="text-sm text-muted">
        vmui can&apos;t reach the control plane right now. The fleet snapshot you last viewed is still cached on this device — open <a href="/" className="underline">Dashboard</a> to use what we have.
      </p>
      <ul className="mt-2 space-y-1 text-xs text-muted">
        <li>• Live actions (start/stop/snapshot) need the server back online.</li>
        <li>• Reads from cached pages will return what was last seen.</li>
        <li>• This page comes from the service worker fallback.</li>
      </ul>
    </main>
  );
}
