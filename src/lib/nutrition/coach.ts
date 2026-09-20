import "server-only";

import { loadCopilotSignals } from "@/lib/copilot/signals";
import { journalUserId, ownerActor } from "@/lib/home/access";
import { credential } from "@/lib/home/credentials";
import { ha } from "@/lib/home/ha-client";
import { loadProfile, recordCoachMessage } from "./store";
import type { NutritionSummary } from "./summary";

/** The coach is mancai's `coach-evaluation.ts` made deterministic: the RULES
 *  decide whether and what kind of message goes out (so it is testable and
 *  never spams), and the LLM — when a codai key exists — only writes the
 *  sentence. Without a key the canned RO line is used. Max one push per day,
 *  only inside the profile's coach window. */

export type CoachKind = "streak_risk" | "over_target" | "under_target" | "protein_low" | "celebration" | "weekly_review" | "no_data";

export interface CoachDecision {
  kind: CoachKind;
  priority: "low" | "medium" | "high";
  /** Canned Romanian text used when no LLM is configured. */
  fallback: string;
  /** Facts for the LLM to phrase. */
  facts: string;
}

export function decide(s: NutritionSummary, now = new Date()): CoachDecision | null {
  const hour = now.getHours();
  const dow = now.getDay(); // 0 = Sunday
  const t = s.targets;
  const daysWithData = s.week.filter((d) => d.meals > 0);
  const last5 = s.week.slice(-6, -1); // yesterday back 5 days
  const over = last5.filter((d) => d.meals > 0 && d.calories > t.calories * 1.15).length;
  const under = last5.filter((d) => d.meals > 0 && d.calories < t.calories * 0.7).length;
  const onTarget = last5.filter((d) => d.meals > 0 && Math.abs(d.calories - t.calories) <= t.calories * 0.1).length;

  if (daysWithData.length < 2) return null; // too new to say anything useful

  if (s.streak >= 3 && s.today.meals === 0 && hour >= 19)
    return { kind: "streak_risk", priority: "high", fallback: `Streak-ul tău de ${s.streak} zile e în pericol — nimic înregistrat azi. O poză la cină și e salvat.`, facts: `streak ${s.streak} zile, azi 0 mese, ora ${hour}` };

  if (dow === 0 && hour >= 18 && daysWithData.length >= 5) {
    const avg = Math.round(daysWithData.reduce((a, d) => a + d.calories, 0) / daysWithData.length);
    return { kind: "weekly_review", priority: "low", fallback: `Săptămâna asta: ${daysWithData.length}/7 zile înregistrate, medie ${avg} kcal față de ținta ${t.calories}. ${onTarget >= 4 ? "Foarte constant!" : "Săptămâna viitoare mai aproape de țintă?"}`, facts: `zile cu date ${daysWithData.length}/7, medie ${avg} kcal, țintă ${t.calories}, zile la țintă ${onTarget}` };
  }

  if (over >= 4) return { kind: "over_target", priority: "medium", fallback: `Ultimele zile ai fost constant peste țintă (~${Math.round(last5.reduce((a, d) => a + d.calories, 0) / 5 - t.calories)} kcal/zi). Vrei să ajustăm ținta sau porțiile?`, facts: `${over}/5 zile peste țintă cu >15 %` };
  if (under >= 4) return { kind: "under_target", priority: "medium", fallback: `De câteva zile ești mult sub țintă. Dacă e intenționat, ok — dacă nu, verifică să nu sari mese.`, facts: `${under}/5 zile sub 70 % din țintă` };

  if (s.today.meals >= 2 && s.today.protein < t.protein * 0.4 && hour >= 16)
    return { kind: "protein_low", priority: "low", fallback: `Proteine azi: ${s.today.protein} g din ${t.protein} g. Cina cu ceva proteic ar echilibra ziua.`, facts: `proteine ${s.today.protein}/${t.protein} g la ora ${hour}` };

  if (onTarget >= 5) return { kind: "celebration", priority: "low", fallback: `5 zile la rând la țintă. Așa se face! 🎉`, facts: `${onTarget} zile consecutive la ±10 % din țintă` };

  return null;
}

function inWindow(from: string, to: string, now = new Date()): boolean {
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= (fh ?? 0) * 60 + (fm ?? 0) && cur <= (th ?? 23) * 60 + (tm ?? 59);
}

/** One sentence in Romanian from codai; falls back to the canned text. */
async function phrase(d: CoachDecision, s: NutritionSummary): Promise<string> {
  const key = credential("CODAI_API_KEY");
  if (!key) return d.fallback;
  try {
    const r = await fetch("https://ai.codai.ro/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        model: "codai-fast",
        temperature: 0.7,
        max_tokens: 120,
        messages: [
          { role: "system", content: "Ești un coach de nutriție cald, concis, în română. Scrii o singură notificare de 1-2 propoziții, fără emoji-uri multiple, fără sfaturi medicale, tu la persoana a doua. Răspunzi doar cu textul notificării." },
          { role: "user", content: `Tip: ${d.kind}. Fapte: ${d.facts}. Țintă zilnică ${s.targets.calories} kcal, azi ${s.today.calories} kcal în ${s.today.meals} mese, streak ${s.streak} zile.` },
        ],
      }),
    });
    if (!r.ok) return d.fallback;
    const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const txt = j.choices?.[0]?.message?.content?.trim();
    return txt && txt.length > 10 && txt.length < 300 ? txt : d.fallback;
  } catch {
    return d.fallback;
  }
}

/** Run once per poll; sends at most one notification per day. Household-level:
 *  `s` must be the owner's summary and the window comes from the owner's profile. */
export async function runCoach(s: NutritionSummary, now = new Date()): Promise<{ sent: boolean; kind?: CoachKind; reason: string }> {
  const o = await ownerActor();
  const p = await loadProfile(o ? journalUserId(o) : null, true);
  if (!p.coachEnabled) return { sent: false, reason: "disabled" };
  if (!inWindow(p.coachFrom, p.coachTo, now)) return { sent: false, reason: "outside window" };
  if (s.coach && now.getTime() - s.coach.at < 24 * 3600_000) return { sent: false, reason: "sent in last 24 h" };
  const d = decide(s, now);
  if (!d) return { sent: false, reason: "nothing worth saying" };
  const text = await phrase(d, s);
  await recordCoachMessage(d.kind, text, d.facts);
  const signals = await loadCopilotSignals();
  if (signals.phoneNotify) {
    await ha
      .callService("notify", signals.phoneNotify, {
        title: { streak_risk: "Streak în pericol", over_target: "Peste țintă", under_target: "Sub țintă", protein_low: "Proteine", celebration: "Bravo", weekly_review: "Bilanț săptămânal", no_data: "Nutriție" }[d.kind],
        message: text,
        data: { tag: "nutrition-coach", group: "nutrition", channel: "Nutriție", importance: d.priority === "high" ? "high" : "default", color: "#10b981", notification_icon: "mdi:food-apple", timeout: 6 * 3600 },
      })
      .catch(() => undefined);
  }
  return { sent: true, kind: d.kind, reason: d.facts };
}
