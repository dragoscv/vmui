import { z } from "zod";

/** Shared (client + server) shapes for the desk-button gesture table. */

export const GESTURES = ["1", "2", "3", "4", "5", "long"] as const;
export type Gesture = (typeof GESTURES)[number];
export const GESTURE_LABEL: Record<Gesture, string> = { "1": "1 click", "2": "2 clickuri", "3": "3 clickuri", "4": "4 clickuri", "5": "5 clickuri", long: "apăsare lungă" };

export const buttonActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("water_add"), ml: z.number().int().min(10).max(2000) }),
  z.object({ type: z.literal("water_undo") }),
  z.object({ type: z.literal("ha_script"), script: z.string().regex(/^[a-z0-9_]{1,64}$/) }),
  z.object({ type: z.literal("ha_service"), service: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/), entityId: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/).optional() }),
  z.object({ type: z.literal("intercom_open") }),
  z.object({ type: z.literal("intercom_arm"), minutes: z.number().int().min(1).max(240) }),
  z.object({ type: z.literal("turzx_next") }),
  z.object({ type: z.literal("turzx_pause") }),
  z.object({ type: z.literal("ambilight_movie") }),
]);
export type ButtonAction = z.infer<typeof buttonActionSchema>;

export const buttonBindingsSchema = z.object({
  version: z.literal(1),
  gestures: z.record(z.enum(GESTURES), buttonActionSchema),
});
export type ButtonBindings = z.infer<typeof buttonBindingsSchema>;

export const BUTTON_DEFAULTS: ButtonBindings = {
  version: 1,
  gestures: {
    "1": { type: "water_add", ml: 250 },
    "2": { type: "water_add", ml: 100 },
    "3": { type: "turzx_next" },
    "4": { type: "ambilight_movie" },
    "5": { type: "intercom_arm", minutes: 45 },
    long: { type: "water_undo" },
  },
};

export function describeAction(a: ButtonAction): string {
  switch (a.type) {
    case "none": return "nimic";
    case "water_add": return `+${a.ml} ml apă`;
    case "water_undo": return "anulează ultima apă";
    case "ha_script": return `script HA: ${a.script}`;
    case "ha_service": return `${a.service}${a.entityId ? ` → ${a.entityId}` : ""}`;
    case "intercom_open": return "deschide interfonul";
    case "intercom_arm": return `auto-deschidere ${a.minutes} min`;
    case "turzx_next": return "Turzx: view următor";
    case "turzx_pause": return "Turzx: pauză/continuă";
    case "ambilight_movie": return "Ambilight: movie mode";
  }
}
