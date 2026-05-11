"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { upsertStickyNoteAction, deleteStickyNoteAction } from "@/server/actions/sticky-and-tags";

type Color = "amber" | "rose" | "emerald" | "sky" | "violet";
const COLOR_BG: Record<Color, string> = {
  amber: "bg-amber-200/90 text-amber-950",
  rose: "bg-rose-200/90 text-rose-950",
  emerald: "bg-emerald-200/90 text-emerald-950",
  sky: "bg-sky-200/90 text-sky-950",
  violet: "bg-violet-200/90 text-violet-950",
};

interface Note { id: string; body: string; color: string; createdAt: string; createdBy: string | null }
interface Props { accountId: string; providerInstanceId: string; notes: Note[] }

export function StickyNotesClient({ accountId, providerInstanceId, notes }: Props) {
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState<Color>("amber");
  const [pending, start] = useTransition();

  function add() {
    if (!draft.trim()) return;
    start(async () => {
      try {
        await upsertStickyNoteAction({ accountId, providerInstanceId, body: draft, color });
        setDraft("");
        toast.success("Note added");
      } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    });
  }

  function remove(id: string) {
    start(async () => {
      try { await deleteStickyNoteAction(id); toast.success("Note deleted"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    });
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Sticky notes</h3>
        <span className="text-xs text-zinc-500">{notes.length} note{notes.length === 1 ? "" : "s"}</span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Jot a note about this VM…"
          rows={2}
          className="flex-1 rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-sm"
          maxLength={2000}
        />
        <div className="flex flex-col gap-2">
          <select value={color} onChange={(e) => setColor(e.target.value as Color)} className="rounded-md bg-zinc-900 border border-zinc-800 px-2 py-1 text-xs">
            {(["amber", "rose", "emerald", "sky", "violet"] as Color[]).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" disabled={pending || !draft.trim()} onClick={add} className="rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-3 py-1.5 text-sm">
            Add
          </button>
        </div>
      </div>

      {notes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {notes.map((n) => {
            const bg = COLOR_BG[(n.color as Color)] ?? COLOR_BG.amber;
            return (
              <div key={n.id} className={`relative rounded-lg p-3 text-sm shadow ${bg}`}>
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  className="absolute right-2 top-1.5 text-xs opacity-60 hover:opacity-100"
                  aria-label="Delete note"
                >×</button>
                <div className="whitespace-pre-wrap pr-4">{n.body}</div>
                <div className="mt-2 text-[10px] opacity-70">
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
