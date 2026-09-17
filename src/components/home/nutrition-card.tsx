"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ACTIVITY, GOALS, MEAL_TYPES, type MealType, type NutritionProfile } from "@/lib/nutrition/schema";
import type { NutritionSummary } from "@/lib/nutrition/summary";
import { cn } from "@/lib/utils";
import { addMealAction, addWaterAction, deleteMealAction, saveNutritionProfileAction, undoWaterAction } from "@/server/actions/nutrition";
import { Droplets, Flame, Plus, Salad, Scale, Trash2, Undo2, UtensilsCrossed } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

const MEAL_LABEL: Record<MealType, string> = { breakfast: "Mic dejun", lunch: "Prânz", dinner: "Cină", snack: "Gustare" };
const GOAL_LABEL: Record<(typeof GOALS)[number], string> = { maintain: "Menținere", lose: "Slăbire", gain: "Masă" };
const ACTIVITY_LABEL: Record<(typeof ACTIVITY)[number], string> = { sedentary: "Sedentar", light: "Ușor", moderate: "Moderat", active: "Activ", very_active: "Foarte activ" };

const fmtTime = (ms: number) => new Intl.DateTimeFormat("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" }).format(new Date(ms));
const fmtDay = (day: string) => new Intl.DateTimeFormat("ro-RO", { weekday: "short", timeZone: "Europe/Bucharest" }).format(new Date(day + "T12:00:00"));

/** Meal journal + targets. Same data the phone assistant writes via
 *  POST /api/nutrition/meal; this is the desk view and the manual fallback. */
export function NutritionCard({ initial, profile }: { initial: NutritionSummary; profile: NutritionProfile }) {
  const s = initial;
  const [busy, setBusy] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ name: "", mealType: "snack" as MealType, calories: "", protein: "", carbs: "", fats: "" });
  const [p, setP] = React.useState<NutritionProfile>(profile);
  const dirty = JSON.stringify(p) !== JSON.stringify(profile);

  const pct = s.targets.calories > 0 ? Math.min(1.2, s.today.calories / s.targets.calories) : 0;
  const over = s.today.calories > s.targets.calories;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.calories) return;
    setBusy("add");
    const r = await addMealAction({
      name: form.name.trim(),
      mealType: form.mealType,
      calories: Number(form.calories),
      protein: Number(form.protein || 0),
      carbs: Number(form.carbs || 0),
      fats: Number(form.fats || 0),
      confidence: 1,
    });
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success(`${form.name.trim()} · ${form.calories} kcal`);
      setForm({ name: "", mealType: form.mealType, calories: "", protein: "", carbs: "", fats: "" });
    }
  };
  const remove = async (id: string, name: string) => {
    setBusy(id);
    const r = await deleteMealAction(id);
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else toast.success(`Șters: ${name}`);
  };
  const water = async (kind: "add" | "undo") => {
    setBusy("water");
    const r = kind === "add" ? await addWaterAction(250) : await undoWaterAction();
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else toast.success(kind === "add" ? "+250 ml apă" : "Ultimul pahar anulat");
  };
  const saveProfile = async () => {
    setBusy("profile");
    const r = await saveNutritionProfileAction(p);
    setBusy(null);
    if (!r.ok) toast.error(r.error);
    else toast.success("Profil salvat — țintele se recalculează");
  };

  return (
    <section className="space-y-5" aria-labelledby="nutrition-h">
      <header className="glass rounded-2xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Salad className="size-5 text-primary" aria-hidden />
          <div>
            <h3 id="nutrition-h" className="font-semibold">Jurnal alimentar</h3>
            <p className="text-xs text-muted">Mesele intră de pe telefon (codai, din poză) sau de aici; țintele urmăresc cântarul și profilul</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <Scale className="size-3.5" aria-hidden />
          <span>
            {s.targets.weightKg.toFixed(1)} kg <span className="opacity-70">({s.targets.weightSource === "scale" ? "cântar" : "profil"})</span>
          </span>
          <Badge variant={s.streak >= 3 ? "success" : "muted"}>{s.streak} zile la rând</Badge>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Today */}
        <div className="glass rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Azi</p>
              <p className="text-3xl font-semibold tabular-nums">
                {Math.round(s.today.calories)} <span className="text-base font-normal text-muted">/ {s.targets.calories} kcal</span>
              </p>
            </div>
            <div className="text-right text-sm">
              <p className={cn("tabular-nums font-medium", over ? "text-[var(--color-warning)]" : "text-[var(--color-success)]")}>
                {over ? `+${Math.round(-s.remaining.calories)}` : Math.round(s.remaining.calories)} kcal {over ? "peste" : "rămase"}
              </p>
              {s.balance !== null && (
                <p className="text-xs text-muted tabular-nums">
                  balanță {s.balance > 0 ? "+" : ""}{Math.round(s.balance)} kcal
                </p>
              )}
            </div>
          </div>
          <div className="h-2 rounded-full bg-[color-mix(in_oklch,var(--color-fg)_10%,transparent)] overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={120} aria-label="Calorii azi față de țintă">
            <div className={cn("h-full rounded-full transition-[width]", over ? "bg-[var(--color-warning)]" : "bg-primary")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            {(
              [
                ["Proteine", s.today.protein, s.targets.protein],
                ["Carbo", s.today.carbs, s.targets.carbs],
                ["Grăsimi", s.today.fats, s.targets.fats],
              ] as const
            ).map(([label, v, t]) => (
              <div key={label} className="rounded-xl border border-[var(--color-border)] p-2.5">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="tabular-nums font-medium">
                  {Math.round(v)} <span className="text-xs font-normal text-muted">/ {t} g</span>
                </dd>
                <div className="mt-1 h-1 rounded-full bg-[color-mix(in_oklch,var(--color-fg)_10%,transparent)] overflow-hidden">
                  <div className="h-full bg-primary/80" style={{ width: `${Math.min(100, t > 0 ? (v / t) * 100 : 0)}%` }} />
                </div>
              </div>
            ))}
          </dl>

          <div className="rounded-xl border border-[var(--color-border)] p-3 flex flex-wrap items-center gap-3">
            <Droplets className={cn("size-4 shrink-0", s.water.underPace ? "text-[var(--color-warning)]" : "text-primary")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="tabular-nums font-medium">
                  {(s.water.ml / 1000).toFixed(2).replace(/\.?0+$/, "")} L <span className="text-xs font-normal text-muted">/ {(s.water.targetMl / 1000).toFixed(2).replace(/\.?0+$/, "")} L · {s.water.glasses} pahare</span>
                </span>
                <span className="text-xs text-muted">
                  {s.water.lastAt ? `ultimul ${fmtTime(s.water.lastAt)}` : "nimic azi"}
                  {s.water.underPace && <span className="ml-2 text-[var(--color-warning)]">e timpul să bei</span>}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-[color-mix(in_oklch,var(--color-fg)_10%,transparent)] overflow-hidden" role="progressbar" aria-valuenow={s.water.ml} aria-valuemin={0} aria-valuemax={s.water.targetMl} aria-label="Apă azi">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.min(100, s.water.targetMl > 0 ? (s.water.ml / s.water.targetMl) * 100 : 0)}%` }} />
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={busy === "water"} onClick={() => water("add")} aria-label="Adaugă un pahar de 250 ml">
                <Plus className="size-3.5" aria-hidden /> pahar
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === "water" || s.water.glasses === 0} onClick={() => water("undo")} aria-label="Anulează ultimul pahar">
                <Undo2 className="size-3.5" aria-hidden />
              </Button>
            </div>
          </div>

          <ul className="divide-y divide-[var(--color-border)]" aria-label="Mesele de azi">
            {s.meals.length === 0 && <li className="py-3 text-sm text-muted">Nimic înregistrat azi. Trimite-i lui codai o poză cu farfuria sau adaugă manual.</li>}
            {s.meals.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-12 shrink-0 tabular-nums text-xs text-muted">{fmtTime(m.at)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {m.name}
                  <span className="ml-2 text-xs text-muted">{MEAL_LABEL[m.mealType as MealType] ?? m.mealType}</span>
                  {m.confidence < 0.5 && <span className="ml-2 text-xs text-[var(--color-warning)]">aprox.</span>}
                  {m.source !== "web" && <span className="ml-2 text-xs text-muted">· {m.source}</span>}
                </span>
                <span className="tabular-nums font-medium">{Math.round(m.calories)} kcal</span>
                <span className="hidden sm:inline tabular-nums text-xs text-muted w-24 text-right">{Math.round(m.protein)}p {Math.round(m.carbs)}c {Math.round(m.fats)}g</span>
                <Button variant="ghost" size="icon" aria-label={`Șterge ${m.name}`} disabled={busy === m.id} onClick={() => remove(m.id, m.name)}>
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>

          <form onSubmit={add} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_5rem_4rem_4rem_4rem_auto] sm:items-end" aria-label="Adaugă masă">
            <label className="col-span-2 sm:col-span-1 text-xs text-muted">
              Ce ai mâncat
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Omletă cu legume" />
            </label>
            <label className="text-xs text-muted">
              Tip
              <select className="mt-1 block h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm" value={form.mealType} onChange={(e) => setForm({ ...form, mealType: e.target.value as MealType })}>
                {MEAL_TYPES.map((t) => (
                  <option key={t} value={t}>{MEAL_LABEL[t]}</option>
                ))}
              </select>
            </label>
            {(["calories", "protein", "carbs", "fats"] as const).map((k) => (
              <label key={k} className="text-xs text-muted">
                {k === "calories" ? "kcal" : k === "protein" ? "P g" : k === "carbs" ? "C g" : "G g"}
                <Input type="number" inputMode="decimal" min={0} required={k === "calories"} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
            <Button type="submit" disabled={busy === "add"} className="col-span-2 sm:col-span-1">
              <Plus className="size-4" aria-hidden /> Adaugă
            </Button>
          </form>
        </div>

        {/* Week + profile */}
        <div className="space-y-4">
          <div className="glass rounded-2xl p-4 sm:p-5">
            <p className="text-xs uppercase tracking-wide text-muted mb-3">Ultimele 7 zile</p>
            <div className="flex items-end gap-1.5 h-24" role="img" aria-label={`Calorii pe zi: ${s.week.map((d) => `${fmtDay(d.day)} ${Math.round(d.calories)}`).join(", ")}`}>
              {s.week.map((d) => {
                const h = s.targets.calories > 0 ? Math.min(1, d.calories / (s.targets.calories * 1.2)) : 0;
                const o = d.calories > s.targets.calories;
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex-1 flex items-end">
                      <div className={cn("w-full rounded-t", o ? "bg-[var(--color-warning)]" : d.meals ? "bg-primary" : "bg-[color-mix(in_oklch,var(--color-fg)_12%,transparent)]")} style={{ height: `${Math.max(4, h * 100)}%` }} title={`${Math.round(d.calories)} kcal · ${d.meals} mese`} />
                    </div>
                    <span className="text-[10px] text-muted">{fmtDay(d.day)}</span>
                  </div>
                );
              })}
            </div>
            {s.coach && (
              <p className="mt-3 text-xs text-muted border-t border-[var(--color-border)] pt-3">
                <UtensilsCrossed className="inline size-3 mr-1" aria-hidden />
                {s.coach.message}
              </p>
            )}
          </div>

          <div className="glass rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wide text-muted">Profil și ținte</p>
              <span className="text-xs text-muted tabular-nums">BMR {s.targets.bmr} · TDEE {s.targets.tdee}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted">
              <label>
                Obiectiv
                <select className="mt-1 block h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm text-[var(--color-fg)]" value={p.goal} onChange={(e) => setP({ ...p, goal: e.target.value as NutritionProfile["goal"] })}>
                  {GOALS.map((g) => (
                    <option key={g} value={g}>{GOAL_LABEL[g]}</option>
                  ))}
                </select>
              </label>
              <label>
                Activitate
                <select className="mt-1 block h-9 w-full rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm text-[var(--color-fg)]" value={p.activity} onChange={(e) => setP({ ...p, activity: e.target.value as NutritionProfile["activity"] })}>
                  {ACTIVITY.map((a) => (
                    <option key={a} value={a}>{ACTIVITY_LABEL[a]}</option>
                  ))}
                </select>
              </label>
              <label>
                Înălțime (cm)
                <Input type="number" min={100} max={230} value={p.heightCm} onChange={(e) => setP({ ...p, heightCm: Number(e.target.value) })} />
              </label>
              <label>
                Data nașterii
                <Input type="date" value={p.birthDate} onChange={(e) => setP({ ...p, birthDate: e.target.value })} />
              </label>
              <label>
                Greutate fallback (kg)
                <Input type="number" min={30} max={300} step={0.1} value={p.weightKgFallback} onChange={(e) => setP({ ...p, weightKgFallback: Number(e.target.value) })} />
              </label>
              <label>
                Țintă manuală (kcal, gol = calculată)
                <Input type="number" min={800} max={6000} value={p.targetCaloriesOverride ?? ""} onChange={(e) => setP({ ...p, targetCaloriesOverride: e.target.value ? Number(e.target.value) : null })} />
              </label>
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-xs text-muted">
                <Switch checked={p.coachEnabled} onCheckedChange={(v) => setP({ ...p, coachEnabled: v })} aria-label="Antrenor pe telefon" />
                <Flame className="size-3.5" aria-hidden /> Antrenor pe telefon ({p.coachFrom}–{p.coachTo})
              </label>
              <Button size="sm" disabled={!dirty || busy === "profile"} onClick={saveProfile}>Salvează</Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
