/** Last "something happened" for the screens: turzx pops a card when a meal is
 *  saved. Same one-slot pattern as copilot signals; the id changes per event
 *  so the overlay shows each once. */
export interface NutritionEvent {
  kind: "meal" | "coach";
  at: number;
  name: string;
  calories?: number;
  mealType?: string;
  text?: string;
}

type Store = { current: NutritionEvent | null };
const store: Store = ((globalThis as unknown as { __vmuiNutritionEvent?: Store }).__vmuiNutritionEvent ??= { current: null });

export function setNutritionEvent(e: NutritionEvent): void {
  store.current = e;
}

/** Events older than 60 s are not worth popping any more. */
export function currentNutritionEvent(): NutritionEvent | null {
  const e = store.current;
  return e && Date.now() - e.at < 60_000 ? e : null;
}
