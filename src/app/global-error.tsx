"use client";

// Replaces the root layout when it throws, so no i18n provider or theme
// attributes are mounted here: English-only, tokens read straight from globals.css.
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
        <main className="mx-auto mt-16 flex w-full max-w-md flex-col items-center gap-4 px-4 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-danger)_12%,transparent)] text-[var(--color-danger)]">
            <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
            <p className="text-sm text-[var(--color-fg-muted)]">The app failed to render. You can retry or go back home.</p>
            {error.digest ? <p className="font-mono text-xs text-[var(--color-fg-muted)]">Error id: {error.digest}</p> : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-sm font-medium text-[var(--color-primary-fg)] hover:brightness-110"
            >
              Retry
            </button>
            <a
              href="/"
              className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium hover:border-[color-mix(in_oklch,var(--color-primary)_55%,var(--color-border))]"
            >
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
