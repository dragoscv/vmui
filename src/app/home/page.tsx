import { HomeDashboard } from "@/components/home/home-dashboard";
import { loadCopilotSignals } from "@/lib/copilot/signals";
import { loadDisplaySettings } from "@/lib/display/settings";
import { loadButtonBindings } from "@/lib/home/button-bindings";
import { credential } from "@/lib/home/credentials";
import { intercomState } from "@/lib/home/intercom";
import { loadProfile } from "@/lib/nutrition/store";
import { nutritionSummary } from "@/lib/nutrition/summary";
import { loadPomodoro, loadTurzxSettings } from "@/lib/turzx/settings";
import { homeAvailability, listPlacedDevices, loadHomeStates, wallSetting } from "@/server/queries/home";
import { AlertTriangle, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home — vmui" };

function intercomProps() {
  const s = intercomState();
  return { ringing: s.ringingSince !== null, ringingSince: s.ringingSince, lastRingAt: s.lastRingAt, lastOpenAt: s.lastOpenAt, autoOpenUntil: s.autoOpenUntil, log: s.log };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, devices, states, avail, wall, turzx, display, pomodoro, copilot, nutrition, nutritionProfile, buttons] = await Promise.all([searchParams, listPlacedDevices(), loadHomeStates(), homeAvailability(), wallSetting(), loadTurzxSettings(), loadDisplaySettings(), loadPomodoro(), loadCopilotSignals(), nutritionSummary(), loadProfile(), loadButtonBindings()]);
  const haScripts = Object.keys(states).filter((id) => id.startsWith("script.")).map((id) => id.slice("script.".length)).sort();
  // Any HA light that can show a colour may carry a Copilot signal.
  const rgbLights = Object.values(states)
    .filter((s) => s.entity_id.startsWith("light.") && s.entity_id !== "light.hyperhdr" && ((s.attributes.supported_color_modes as string[] | undefined) ?? []).some((m) => m === "rgb" || m === "hs" || m === "rgbw" || m === "rgbww" || m === "xy"))
    .map((s) => ({ id: s.entity_id, name: String(s.attributes.friendly_name ?? s.entity_id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const initialTab = tab === "devices" || tab === "ambilight" || tab === "displays" || tab === "nutrition" ? tab : "plan";
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

      <HomeDashboard devices={devices} initialStates={states} haUrl={avail.url} initialTab={initialTab} wall={wall} turzx={turzx} display={display} pomodoro={pomodoro} copilot={copilot} rgbLights={rgbLights} nutrition={nutrition} nutritionProfile={nutritionProfile} intercom={intercomProps()} espToken={credential("ESP_DISPLAY_TOKEN") ?? ""} buttons={buttons} haScripts={haScripts} />
    </div>
  );
}
