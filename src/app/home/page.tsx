import { HomeDashboard } from "@/components/home/home-dashboard";
import { homeAvailability, listPlacedDevices, loadHomeStates, wallSetting } from "@/server/queries/home";
import { AlertTriangle, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home — vmui" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, devices, states, avail, wall] = await Promise.all([searchParams, listPlacedDevices(), loadHomeStates(), homeAvailability(), wallSetting()]);
  const initialTab = tab === "devices" || tab === "ambilight" ? tab : "plan";
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
          <p className="text-sm text-muted">Every light, sensor and screen in the flat — and the ambilight that ties them together.</p>
        </div>
        {avail.url && (
          <a
            href={avail.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-[var(--color-fg)]"
          >
            Home Assistant <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </header>

      {!avail.ok && (
        <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color-mix(in_oklch,var(--color-warning)_50%,var(--color-border))] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
          <div>
            <p className="font-medium">Home Assistant is not reachable</p>
            <p className="text-muted">{avail.error}. Showing the last known layout; controls will fail until it is back.</p>
          </div>
        </div>
      )}

      <HomeDashboard devices={devices} initialStates={states} haUrl={avail.url} initialTab={initialTab} wall={wall} />
    </div>
  );
}
