/** What HyperHDR is doing, read from the hyperhdr_integration light's attributes.
 *
 *  `light.hyperhdr` is the integration's OWN light: `on` only while HA holds
 *  priority 50 with a colour/effect. Movie mode = the screen grabber owns
 *  priority 245, so the light reads `off` for the whole film; the ESP32 and
 *  the copilot mute both trusted that for a week (2026-09-16). Safe for
 *  client components: no server imports. */
export type AmbilightStatus = "movie" | "music" | "idle" | "unreachable" | "unknown";

type StateLike = { state: string; attributes: Record<string, unknown> } | null | undefined;

export function ambilightStatus(h: StateLike): AmbilightStatus {
  if (!h) return "unknown";
  if (h.state === "unavailable" || h.attributes.connection_status !== "Connected") return "unreachable";
  const comp = h.attributes.active_component;
  if (comp === "SYSTEMGRABBER" || comp === "VIDEOGRABBER") return "movie";
  if (comp === "EFFECT" || (h.state === "on" && h.attributes.effect)) return "music";
  return "idle";
}

export const AMBILIGHT_LABEL: Record<AmbilightStatus, string> = {
  movie: "movie",
  music: "muzica",
  idle: "idle",
  unreachable: "OPRIT",
  unknown: "--",
};
