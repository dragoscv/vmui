import { ha, type HaState } from "@/lib/home/ha-client";
import "server-only";
import { ensureActivityFeed } from "./activity";
import type { Framebuffer } from "./framebuffer";
import { renderMessage, renderView, VIEW_ORDER, type ViewId } from "./views";

// Per-node gallery state. One PC serves any number of displays; each keeps
// its own cursor so two screens can show different things.

export const ROTATE_MS = 8000;

type Node = {
  index: number;
  paused: boolean;
  lastAdvance: number;
  lastSeen: number;
  message: { title: string; body: string; until: number; render?: () => Framebuffer } | null;
};

declare global {
  // eslint-disable-next-line no-var
  var __vmuiEspGallery__: { nodes: Map<string, Node>; states: Map<string, HaState>; statesAt: number } | undefined;
}

const g = (globalThis.__vmuiEspGallery__ ??= { nodes: new Map(), states: new Map(), statesAt: 0 });

function node(name: string): Node {
  let n = g.nodes.get(name);
  if (!n) {
    n = { index: 0, paused: false, lastAdvance: Date.now(), lastSeen: 0, message: null };
    g.nodes.set(name, n);
  }
  return n;
}

async function states(): Promise<Map<string, HaState>> {
  // One HA round-trip per 2 s serves every node; the ESP polls every 5 s.
  if (Date.now() - g.statesAt > 2000) {
    try {
      const all = await ha.states();
      g.states = new Map(all.map((s) => [s.entity_id, s]));
      g.statesAt = Date.now();
    } catch {
      // keep the last good snapshot
    }
  }
  return g.states;
}

export function listNodes(): Array<{ name: string; view: ViewId; paused: boolean; lastSeen: number }> {
  return [...g.nodes.entries()].map(([name, n]) => ({ name, view: VIEW_ORDER[n.index]!, paused: n.paused, lastSeen: n.lastSeen }));
}

export function currentView(name: string): ViewId {
  return VIEW_ORDER[node(name).index]!;
}

export function setView(name: string, view: ViewId): void {
  const n = node(name);
  n.index = Math.max(0, VIEW_ORDER.indexOf(view));
  n.lastAdvance = Date.now();
}

export function togglePause(name: string): boolean {
  const n = node(name);
  n.paused = !n.paused;
  n.lastAdvance = Date.now();
  return n.paused;
}

export function nextView(name: string, step = 1): ViewId {
  const n = node(name);
  n.index = (n.index + step + VIEW_ORDER.length) % VIEW_ORDER.length;
  n.lastAdvance = Date.now();
  return VIEW_ORDER[n.index]!;
}

export function showMessage(name: string, title: string, body: string, seconds = 10): void {
  node(name).message = { title, body, until: Date.now() + seconds * 1000 };
}

/** Like showMessage but with a purpose-built frame (bars, dots) instead of
 *  wrapped text. The renderer runs on every fetch so it can animate on time. */
export function showFrame(name: string, render: () => Framebuffer, seconds = 8): void {
  node(name).message = { title: "", body: "", until: Date.now() + seconds * 1000, render };
}

export async function frameFor(name: string, ambilightMode: string): Promise<Framebuffer> {
  ensureActivityFeed();
  const n = node(name);
  n.lastSeen = Date.now();
  if (n.message && n.message.until > Date.now()) return n.message.render ? n.message.render() : renderMessage(n.message.title, n.message.body);
  n.message = null;
  if (!n.paused && Date.now() - n.lastAdvance >= ROTATE_MS) {
    n.index = (n.index + 1) % VIEW_ORDER.length;
    n.lastAdvance = Date.now();
  }
  return renderView(VIEW_ORDER[n.index]!, { states: await states(), now: new Date(), node: name, paused: n.paused, ambilightMode });
}

/** Render one view without advancing or touching the node's gallery state. */
export async function previewView(name: string, id: ViewId, ambilightMode: string): Promise<Framebuffer> {
  ensureActivityFeed();
  return renderView(id, { states: await states(), now: new Date(), node: name, paused: false, ambilightMode });
}
