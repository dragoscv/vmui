import { TimeMachine } from "@/components/timeline/time-machine";

export const dynamic = "force-dynamic";

export default function TimelinePage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Time machine</h1>
        <p className="text-sm text-muted">Scrub through probe samples + audit log together. Drag the slider to inspect any moment.</p>
      </header>
      <TimeMachine />
    </main>
  );
}
