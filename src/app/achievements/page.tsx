import { computeAchievements } from "@/lib/achievements";
import { Rocket, Boxes, Camera, Archive, RotateCcw, Globe, Bot, Award, Flame, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

const ICONS = { Rocket, Boxes, Camera, Archive, RotateCcw, Globe, Bot, Award, Flame } as const;

export default async function AchievementsPage() {
  const { achievements, streak, totalActions } = await computeAchievements();
  const unlocked = achievements.filter((a) => a.unlocked).length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Trophy className="h-6 w-6 text-amber-400" /> Achievements</h1>
          <p className="text-sm text-muted">Operator XP. Computed from your audit log.</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Stat label="Unlocked" value={`${unlocked}/${achievements.length}`} />
          <Stat label="Streak" value={streak.current.toString()} subtitle={`longest ${streak.longest}`} />
          <Stat label="Actions" value={totalActions.toString()} />
        </div>
      </header>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {achievements.map((a) => {
          const Icon = (ICONS as Record<string, typeof Rocket>)[a.icon] ?? Award;
          const pct = Math.round((a.progress / a.goal) * 100);
          return (
            <li key={a.id} className={`rounded-lg border p-3 ${a.unlocked ? "border-amber-400/40 bg-gradient-to-br from-amber-500/15 to-amber-500/0" : "border-[var(--color-border)] bg-[var(--color-surface-muted)]"}`}>
              <div className="flex items-start gap-3">
                <div className={`rounded-md p-2 ${a.unlocked ? "bg-amber-400/20 text-amber-200" : "bg-[var(--color-surface)] text-muted"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">{a.title}</h3>
                  <p className="text-xs text-muted">{a.description}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
                    <div className={`h-full ${a.unlocked ? "bg-amber-400" : "bg-[var(--color-primary)]"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-muted">{a.progress} / {a.goal}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function Stat({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      {subtitle ? <div className="text-[10px] text-muted">{subtitle}</div> : null}
    </div>
  );
}
