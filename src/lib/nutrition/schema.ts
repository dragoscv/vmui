import { z } from "zod";

/** Shared contract between the codai phone assistant, vmui and the screens.
 *  Same field set mancai's GPT-4o prompt produced (`nutritionData`), plus what
 *  a photo-first flow needs (items, confidence, meal type). Safe for clients. */

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const mealItemSchema = z.object({
  name: z.string().min(1).max(80),
  /** Portion as the model saw it: "150 g", "1 felie", "o cană". */
  portion: z.string().max(40).default(""),
  calories: z.number().min(0).max(5000),
  protein: z.number().min(0).max(500).default(0),
  carbs: z.number().min(0).max(1000).default(0),
  fats: z.number().min(0).max(500).default(0),
  fiber: z.number().min(0).max(200).default(0),
});

export const mealInputSchema = z.object({
  name: z.string().min(1).max(120),
  mealType: z.enum(MEAL_TYPES).default("snack"),
  calories: z.number().min(0).max(10000),
  protein: z.number().min(0).max(1000).default(0),
  carbs: z.number().min(0).max(2000).default(0),
  fats: z.number().min(0).max(1000).default(0),
  fiber: z.number().min(0).max(300).default(0),
  /** ms epoch; default now. The phone sends the photo's time when it has one. */
  at: z.number().int().positive().optional(),
  items: z.array(mealItemSchema).max(30).default([]),
  /** 0..1 model confidence; below 0.5 the screens flag it as "aprox." */
  confidence: z.number().min(0).max(1).default(0.7),
  notes: z.string().max(500).default(""),
  /** Where it came from: codai-phone, web, ha, import. */
  source: z.string().max(40).default("web"),
  /** Idempotency key from the client (phone retries on flaky WiFi). */
  clientId: z.string().max(80).optional(),
  /** Journal owner; set server-side from the actor, never trusted from the client. */
  userId: z.string().nullable().optional(),
  /** Sent to Health Connect as NutritionRecord by the phone? Recorded for the UI. */
  syncedToHealthConnect: z.boolean().default(false),
});
export type MealInput = z.infer<typeof mealInputSchema>;

export const GOALS = ["maintain", "lose", "gain"] as const;
export const ACTIVITY = ["sedentary", "light", "moderate", "active", "very_active"] as const;

export const nutritionProfileSchema = z.object({
  version: z.literal(1),
  heightCm: z.number().min(100).max(230),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(["m", "f"]),
  goal: z.enum(GOALS),
  activity: z.enum(ACTIVITY),
  /** Manual override of the computed target; null = computed from TDEE. */
  targetCaloriesOverride: z.number().min(800).max(6000).nullable(),
  /** Macro split as fractions of calories; must sum to ~1. */
  macroSplit: z.object({ protein: z.number(), carbs: z.number(), fats: z.number() }),
  /** Fallback weight when the scale has not reported yet. */
  weightKgFallback: z.number().min(30).max(300),
  dietaryPreference: z.enum(["none", "vegetarian", "vegan", "keto", "mediterranean"]).default("none"),
  allergies: z.array(z.string().max(40)).default([]),
  /** Coach: at most one push per day, only within these hours. */
  coachEnabled: z.boolean().default(true),
  coachFrom: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  coachTo: z.string().regex(/^\d{2}:\d{2}$/).default("21:30"),
});
export type NutritionProfile = z.infer<typeof nutritionProfileSchema>;

export const NUTRITION_PROFILE_DEFAULTS: NutritionProfile = {
  version: 1,
  heightCm: 173,
  birthDate: "1993-12-12",
  sex: "m",
  goal: "maintain",
  activity: "sedentary",
  targetCaloriesOverride: null,
  macroSplit: { protein: 0.3, carbs: 0.4, fats: 0.3 },
  weightKgFallback: 64.6,
  dietaryPreference: "none",
  allergies: [],
  coachEnabled: true,
  coachFrom: "09:00",
  coachTo: "21:30",
};

/** JSON Schema the phone hands to the codai gateway as `response_format:
 *  { type: "json_schema" }` for a photo/text meal analysis. Kept next to the
 *  zod schema so the two cannot drift. */
export const MEAL_ANALYSIS_JSON_SCHEMA = {
  name: "meal_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["userMessage", "meal"],
    properties: {
      userMessage: { type: "string", description: "Descriere prietenoasă în română a ce se vede și a estimării, 1-3 propoziții. Fără JSON, fără liste." },
      meal: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["name", "mealType", "calories", "protein", "carbs", "fats", "fiber", "items", "confidence"],
        properties: {
          name: { type: "string", description: "Numele mesei, scurt, română. Ex: 'Piept de pui cu orez și salată'" },
          mealType: { type: "string", enum: [...MEAL_TYPES] },
          calories: { type: "number" },
          protein: { type: "number", description: "grame" },
          carbs: { type: "number", description: "grame" },
          fats: { type: "number", description: "grame" },
          fiber: { type: "number", description: "grame" },
          confidence: { type: "number", description: "0-1, cât de sigură e estimarea porțiilor" },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "portion", "calories", "protein", "carbs", "fats", "fiber"],
              properties: {
                name: { type: "string" },
                portion: { type: "string" },
                calories: { type: "number" },
                protein: { type: "number" },
                carbs: { type: "number" },
                fats: { type: "number" },
                fiber: { type: "number" },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** System prompt for the phone assistant when a photo/text is a meal.
 *  Distilled from mancai's `getSystemPrompt` (lib/openai.ts) minus the plan
 *  and workflow parts, which live in vmui now. */
export const MEAL_ANALYSIS_SYSTEM_PROMPT = `Ești asistentul de nutriție al utilizatorului. Primești o fotografie și/sau o descriere a unei mese și estimezi conținutul nutrițional.

Reguli:
- Răspunde DOAR cu JSON conform schemei date; textul pentru om merge în "userMessage", în română, cald și concis.
- Descompune masa în componente ("items") cu porția estimată (ex: "150 g", "2 felii", "o lingură"). Totalurile din "meal" sunt suma componentelor.
- Estimează porții realiste după farfurie, tacâmuri, mâini din cadru. Dacă porția e incertă, spune-o în userMessage și pune "confidence" sub 0.6.
- Alege "mealType" după ora locală: 05-10 breakfast, 11-15 lunch, 17-22 dinner, altfel snack — dacă utilizatorul nu spune altceva.
- Dacă imaginea NU conține mâncare sau băutură, pune "meal": null și explică scurt.
- Nu inventa mărci sau ingrediente care nu se văd. Nu da sfaturi medicale.
- Unități: kcal și grame. Numere întregi pentru kcal, o decimală maxim pentru grame.`;
