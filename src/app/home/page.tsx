import { HomeDashboard } from "@/components/home/home-dashboard";
import { normalizeHomeTab, normalizeSettingsSection } from "@/components/home/tabs";
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
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("home");
  return { title: `${t("title")} — vmui` };
}

function intercomProps() {
  const s = intercomState();
  return { ringing: s.ringingSince !== null, ringingSince: s.ringingSince, lastRingAt: s.lastRingAt, lastOpenAt: s.lastOpenAt, autoOpenUntil: s.autoOpenUntil, log: s.log };
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tab?: string; section?: string }> }) {
  const [{ tab, section }, devices, states, avail, wall, turzx, display, pomodoro, copilot, nutrition, nutritionProfile, buttons, t] = await Promise.all([searchParams, listPlacedDevices(), loadHomeStates(), homeAvailability(), wallSetting(), loadTurzxSettings(), loadDisplaySettings(), loadPomodoro(), loadCopilotSignals(), nutritionSummary(), loadProfile(), loadButtonBindings(), getTranslations("home")]);
  const haScripts = Object.keys(states).filter((id) => id.startsWith("script.")).map((id) => id.slice("script.".length)).sort();
  // Any HA light that can show a colour may carry a Copilot signal.
  const rgbLights = Object.values(states)
    .filter((s) => s.entity_id.startsWith("light.") && s.entity_id !== "light.hyperhdr" && ((s.attributes.supported_color_modes as string[] | undefined) ?? []).some((m) => m === "rgb" || m === "hs" || m === "rgbw" || m === "rgbww" || m === "xy"))
    .map((s) => ({ id: s.entity_id, name: String(s.attributes.friendly_name ?? s.entity_id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const initialTab = normalizeHomeTab(tab);
  const initialSection = normalizeSettingsSection(tab, section);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted">{t("subtitle")}</p>
        </div>
        {avail.url && (
          <a
            href={avail.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted transition-colors hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            {t("openHa")} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </header>

      {!avail.ok && (
        <div role="alert" className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color-mix(in_oklch,var(--color-warning)_50%,var(--color-border))] bg-[color-mix(in_oklch,var(--color-warning)_10%,transparent)] p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
          <div>
            <p className="font-medium">{t("haDown")}</p>
            <p className="text-muted">{t("haDownHint", { error: avail.error ?? "" })}</p>
          </div>
        </div>
      )}

      <HomeDashboard devices={devices} initialStates={states} haUrl={avail.url} initialTab={initialTab} initialSection={initialSection} wall={wall} turzx={turzx} display={display} pomodoro={pomodoro} copilot={copilot} rgbLights={rgbLights} nutrition={nutrition} nutritionProfile={nutritionProfile} intercom={intercomProps()} espToken={credential("ESP_DISPLAY_TOKEN") ?? ""} buttons={buttons} haScripts={haScripts} />
    </div>
  );
}
