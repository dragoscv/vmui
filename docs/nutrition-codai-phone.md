# Nutriție: contractul dintre codai phone și vmui

vmui este sursa de adevăr pentru mese (SQLite `meals`), țintă (Mifflin‑St Jeor
din greutatea de pe cântar) și coach. Telefonul face analiza (poză/text →
codai gateway) și scrie în două locuri: vmui (obligatoriu) și Health Connect
(oglindă, ca Samsung Health să vadă masa). Ecranul Turzx, senzorii HA și
notificările vin toate din vmui.

```
poză/text ──► codai gateway (codai, vision, json_schema) ──► confirmare user
                                                                │
                              ┌──────────────────────────────────┤
                              ▼                                  ▼
                 POST vmui /api/nutrition/meal          NutritionRecord → Health Connect
                    │        │        │                          │
                 Turzx    HA sensors  coach → S25          Samsung Health
```

## 1. Ce citește telefonul înainte de analiză

`GET https://<vmui>/api/nutrition/today?k=<ESP_DISPLAY_TOKEN>` → `targets`,
`today`, `remaining`, `meals`, `streak`, `coach`. Asistentul poate spune „mai
ai 640 kcal azi, 70 g proteine”. Același token ca ESP/turzx (LAN/tailnet).

`GET …/api/nutrition/today?k=…&contract=1` → `systemPrompt`, `responseFormat`
(json_schema), `profile`. Telefonul ia promptul de aici, nu îl hardcodează, ca
să pot ajusta fără release.

## 2. Analiza (apel la gateway)

Sursa canonică: `src/lib/nutrition/schema.ts` — `MEAL_ANALYSIS_SYSTEM_PROMPT`
și `MEAL_ANALYSIS_JSON_SCHEMA`. Gateway-ul codai acceptă `image_url` și
`response_format: { type: "json_schema", json_schema }` cu reparare
server‑side (`apps/gateway/src/json-mode.ts`).

```json
{
  "model": "codai",
  "response_format": { "type": "json_schema", "json_schema": <MEAL_ANALYSIS_JSON_SCHEMA> },
  "messages": [
    { "role": "system", "content": "<MEAL_ANALYSIS_SYSTEM_PROMPT>\nOra locală: 13:20. Rămas azi: 640 kcal, 70 g proteine." },
    { "role": "user", "content": [
        { "type": "text", "text": "prânz la birou" },
        { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
    ] }
  ]
}
```

Răspuns: `{ userMessage, meal: { name, mealType, calories, protein, carbs,
fats, fiber, confidence, items[] } | null }`. Afișezi `userMessage` + un card
cu totalurile și butoane **Salvează / Ajustează / Anulează** (ca în mancai).

## 3. Salvarea (după confirmare)

`POST https://<vmui>/api/nutrition/meal?k=…` body = `meal` + câmpurile:

| câmp                    | valoare                                       |
| ----------------------- | --------------------------------------------- |
| `at`                    | epoch ms al pozei (EXIF) sau acum             |
| `source`                | `"codai-phone"`                               |
| `clientId`              | UUID generat pe telefon — idempotent la retry |
| `syncedToHealthConnect` | `true` după ce `NutritionRecord` a fost scris |
| `notes`                 | textul utilizatorului, opțional               |

Răspuns `201 { meal, today, remaining, targets }` (sau `200` dacă `clientId`
exista deja). Turzx pune un card „<nume> salvată · N kcal · rămas M kcal” în
≤3 s; HA primește `sensor.vmui_nutrition_*`.

`PATCH …/meal` `{ id, calories… }` pentru „Ajustează”; `DELETE …/meal?id=`.

## 4. Health Connect (oglindă)

În `HealthTools.kt` un tool nou `health_log_meal` cu permisiunea
`android.permission.health.WRITE_NUTRITION`:

```kotlin
NutritionRecord(
  startTime = at, endTime = at.plusSeconds(60), startZoneOffset = zo, endZoneOffset = zo,
  name = meal.name,
  mealType = when (meal.mealType) { "breakfast" -> MEAL_TYPE_BREAKFAST; "lunch" -> MEAL_TYPE_LUNCH; "dinner" -> MEAL_TYPE_DINNER; else -> MEAL_TYPE_SNACK },
  energy = Energy.kilocalories(meal.calories),
  protein = Mass.grams(meal.protein), totalCarbohydrate = Mass.grams(meal.carbs),
  totalFat = Mass.grams(meal.fats), dietaryFiber = Mass.grams(meal.fiber),
  metadata = Metadata.manualEntry(clientRecordId = clientId),
)
```

Verificat 2026‑09‑16: Samsung Health **citește** `NutritionRecord` din HC, dar
doar când e deschisă (nu în background) — de aceea nu e sursă de adevăr.
Aplicația OKOK a cântarului nu scrie în HC; greutatea intră prin ESP32
(`sensor.office_bluetooth_proxy_1_scale_weight`) și vmui o folosește la țintă.

## 5. Ce mai poate face asistentul cu API-ul

- „Cât mai pot mânca?” → `GET today` → `remaining`.
- „Șterge ultima masă” → `GET meal` → `DELETE`.
- „Schimbă ținta la slăbit” → `PUT today` cu `goal: "lose"` (profil complet).
- Planuri de masă: le generează asistentul din `targets` + `profile.dietaryPreference/allergies`; nu se stochează în vmui (deocamdată) — tabelă `meal_plans` când decidem formatul.

## 6. Coach

Regulile (streak în pericol după 19:00, 4/5 zile peste/sub țintă, proteine
sub 40 % la 16:00, bilanț duminică, 5 zile la țintă) sunt în
`src/lib/nutrition/coach.ts`, deterministe; codai (`CODAI_API_KEY` în
`.private/credentials.env`, `codai-fast`) doar formulează propoziția, altfel
text canonic RO. Max o notificare pe zi, în fereastra din profil, pe același
canal HA companion ca semnalele Copilot (`tag: nutrition-coach`).
