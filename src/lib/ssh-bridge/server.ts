import "server-only";
import { Client as SshClient } from "ssh2";
import { WebSocketServer, type WebSocket } from "ws";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { sshHostKeys } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { Recorder } from "@/lib/terminal-recorder";

/**
 * In-process WebSocket bridge for browser SSH. One singleton server attached
 * to globalThis so dev HMR doesn't leak ports. Each session is described by a
 * short-lived token issued via {@link issueSshToken}; the browser opens
 * `ws://127.0.0.1:VMUI_SSH_BRIDGE_PORT/?token=…`, this bridge looks the token
 * up, calls ssh2, and pipes bytes both ways.
 *
 * Wire protocol:
 *   - Binary frames: raw stdin/stdout passthrough.
 *   - Text frames: JSON control messages.
 *       client → server  {type:"resize", cols, rows}
 *       server → client  {type:"ready"} | {type:"error", message} | {type:"close", code?}
 *
 * Tokens expire 60 seconds after issuance and are single-use.
 */

export interface SshProfile {
  host: string;
  port: number;
  username: string;
  /** Either password or privateKey must be provided. */
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Display label, returned to the UI but unused server-side. */
  label?: string;
  /**
   * Optional command to run instead of a login shell. When set, the bridge
   * opens an interactive `exec` channel (e.g. `docker exec -it <id> /bin/sh`)
   * with a pty so xterm.js still works.
   */
  command?: string;
}

interface PendingToken {
  sessionId: string;
  expiresAt: number;
}

interface StoredSession {
  profile: SshProfile;
  /** Wall-clock ms after which redeem() refuses to issue new tokens. */
  expiresAt: number;
  createdAt: number;
}

interface BridgeState {
  wss: WebSocketServer;
  port: number;
  /** Single-use token → sessionId. Tokens expire 60s after issuance. */
  tokens: Map<string, PendingToken>;
  /** Long-lived session → profile + expiry. User-configurable TTL. */
  sessions: Map<string, StoredSession>;
  /** Synchronous fingerprint cache: "host:port" → sha256 hex. Loaded at
   * boot from sqlite, kept in sync as new pins are recorded. */
  knownHosts: Map<string, string>;
}

declare global {
  // eslint-disable-next-line no-var
  var __vmuiSshBridge: BridgeState | undefined;
}

const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 8 * 60 * 60 * 1000; // 8h hard cap
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const TOKEN_REDEMPTION_MS = 60_000;

function startServer(): BridgeState {
  const port = Number(process.env.VMUI_SSH_BRIDGE_PORT ?? 3738);
  const tokens = new Map<string, PendingToken>();
  const sessions = new Map<string, StoredSession>();
  const knownHosts = new Map<string, string>();
  // Best-effort prime of the in-memory cache. If the DB read fails we
  // simply start in trust-on-first-use mode.
  try {
    const rows = db.select().from(sshHostKeys).all();
    for (const r of rows) {
      knownHosts.set(`${r.host}:${r.port}`, r.fingerprintSha256);
    }
  } catch {
    /* schema may not exist yet on a fresh boot — GC will populate it lazily */
  }
  const wss = new WebSocketServer({ host: "127.0.0.1", port });

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const token = url.searchParams.get("token") ?? "";
    const pending = tokens.get(token);
    tokens.delete(token);
    if (!pending || pending.expiresAt < Date.now()) {
      ws.send(JSON.stringify({ type: "error", message: "Token invalid or expired." }));
      ws.close(1008, "bad token");
      return;
    }
    const session = sessions.get(pending.sessionId);
    if (!session) {
      ws.send(JSON.stringify({ type: "error", message: "Session not found." }));
      ws.close(1008, "no session");
      return;
    }
    const profile = session.profile;

    const ssh = new SshClient();
    let stream: import("ssh2").ClientChannel | null = null;
    let cols = 80;
    let rows = 24;
    let recorder: Recorder | null = null;
    const recordingEnabled = process.env.VMUI_RECORD_TERMINAL !== "0";

    ws.on("message", (data, isBinary) => {
      if (!stream) {
        // Buffer the first JSON resize message before SSH is ready.
        if (!isBinary) {
          try {
            const msg = JSON.parse(data.toString());
            if (msg?.type === "resize") {
              cols = Math.max(1, Math.min(500, Number(msg.cols) || 80));
              rows = Math.max(1, Math.min(200, Number(msg.rows) || 24));
            }
          } catch {
            /* ignore */
          }
        }
        return;
      }
      if (isBinary) {
        stream.write(data);
        return;
      }
      try {
        const msg = JSON.parse(data.toString());
        if (msg?.type === "resize") {
          cols = Math.max(1, Math.min(500, Number(msg.cols) || cols));
          rows = Math.max(1, Math.min(200, Number(msg.rows) || rows));
          stream.setWindow(rows, cols, 0, 0);
        }
      } catch {
        /* ignore non-JSON text frames */
      }
    });

    ws.on("close", () => {
      recorder?.close();
      try {
        stream?.end();
      } catch {
        /* ignore */
      }
      try {
        ssh.end();
      } catch {
        /* ignore */
      }
    });

    ssh.on("ready", () => {
      const onChannel = (err: Error | undefined, ch: import("ssh2").ClientChannel | undefined) => {
        if (err || !ch) {
          ws.send(JSON.stringify({ type: "error", message: `Channel open failed: ${err?.message ?? "unknown"}` }));
          ws.close(1011, "channel open failed");
          ssh.end();
          return;
        }
        stream = ch;
        if (recordingEnabled) {
          try {
            recorder = new Recorder({
              sessionId: pending.sessionId,
              instanceLabel: profile.label ?? null,
              cols,
              rows,
            });
          } catch {
            recorder = null;
          }
        }
        ws.send(JSON.stringify({ type: "ready" }));

        ch.on("data", (chunk: Buffer) => {
          if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
          recorder?.writeOutput(chunk);
        });
        ch.stderr.on("data", (chunk: Buffer) => {
          if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
          recorder?.writeOutput(chunk);
        });
        ch.on("close", () => {
          recorder?.close();
          ws.send(JSON.stringify({ type: "close" }));
          ws.close(1000, "shell ended");
        });
      };
      if (profile.command) {
        ssh.exec(profile.command, { pty: { term: "xterm-256color", cols, rows } }, onChannel);
      } else {
        ssh.shell({ term: "xterm-256color", cols, rows }, onChannel);
      }
    });

    ssh.on("error", (err) => {
      try {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      } catch {
        /* ignore */
      }
      ws.close(1011, "ssh error");
    });

    ssh.connect({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password: profile.password,
      privateKey: profile.privateKey,
      passphrase: profile.passphrase,
      readyTimeout: 15_000,
      // Allow newer + legacy algorithms; let ssh2 pick what the server offers.
      algorithms: undefined,
      hostVerifier: (key: Buffer | string) => {
        const buf = typeof key === "string" ? Buffer.from(key, "base64") : key;
        const fingerprint = createHash("sha256").update(buf).digest("hex");
        const cacheKey = `${profile.host}:${profile.port}`;
        const known = knownHosts.get(cacheKey);
        if (!known) {
          // Trust on first use — record and accept.
          knownHosts.set(cacheKey, fingerprint);
          // Async write; failures don't block the connection.
          void recordHostKey(profile.host, profile.port, "unknown", fingerprint);
          return true;
        }
        if (known === fingerprint) {
          void touchHostKey(profile.host, profile.port);
          return true;
        }
        // MITM or legitimate key rotation — refuse and surface a clear error.
        try {
          ws.send(
            JSON.stringify({
              type: "error",
              message:
                `Host key for ${profile.host}:${profile.port} changed!\n` +
                `Expected sha256:${known.slice(0, 16)}… but got sha256:${fingerprint.slice(0, 16)}…\n` +
                `If this is intentional (e.g. server reinstalled), remove the pin from Settings → SSH known hosts.`,
            }),
          );
        } catch {
          /* ignore */
        }
        return false;
      },
    });
  });

  // Periodic GC for expired tokens and sessions.
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of tokens) if (v.expiresAt < now) tokens.delete(k);
    for (const [k, v] of sessions) if (v.expiresAt < now) sessions.delete(k);
  }, 30_000).unref();

  console.log(`[vmui] ssh bridge listening on ws://127.0.0.1:${port}`);
  return { wss, port, tokens, sessions, knownHosts };
}

function ensure(): BridgeState {
  if (!globalThis.__vmuiSshBridge) {
    globalThis.__vmuiSshBridge = startServer();
  }
  return globalThis.__vmuiSshBridge;
}

/**
 * Issue a long-lived session for a profile. Returns the sessionId and a
 * one-shot wsUrl ready for immediate connection. The session can be redeemed
 * for additional reconnects via {@link redeemSshSession} until `expiresAt`.
 *
 * @param ttlMs how long the session profile is kept in memory; clamped to
 *              [MIN_TTL_MS, MAX_TTL_MS]. Defaults to DEFAULT_TTL_MS (1h).
 */
export function issueSshSession(
  profile: SshProfile,
  ttlMs: number = DEFAULT_TTL_MS,
): { sessionId: string; token: string; wsUrl: string; expiresAt: number } {
  const state = ensure();
  const ttl = Math.min(Math.max(Number.isFinite(ttlMs) ? ttlMs : DEFAULT_TTL_MS, MIN_TTL_MS), MAX_TTL_MS);
  const sessionId = randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + ttl;
  state.sessions.set(sessionId, { profile, expiresAt, createdAt: Date.now() });
  const { token, wsUrl } = issueTokenForSession(state, sessionId);
  return { sessionId, token, wsUrl, expiresAt };
}

/**
 * Mint a fresh single-use redemption token for an existing session. Used to
 * reconnect a closed terminal without re-prompting for credentials. Returns
 * null if the session is unknown or has expired.
 */
export function redeemSshSession(
  sessionId: string,
): { token: string; wsUrl: string; expiresAt: number } | null {
  const state = ensure();
  const session = state.sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    state.sessions.delete(sessionId);
    return null;
  }
  const { token, wsUrl } = issueTokenForSession(state, sessionId);
  return { token, wsUrl, expiresAt: session.expiresAt };
}

export function revokeSshSession(sessionId: string): void {
  ensure().sessions.delete(sessionId);
}

function issueTokenForSession(state: BridgeState, sessionId: string): { token: string; wsUrl: string } {
  const token = randomBytes(24).toString("base64url");
  state.tokens.set(token, { sessionId, expiresAt: Date.now() + TOKEN_REDEMPTION_MS });
  return {
    token,
    wsUrl: `ws://127.0.0.1:${state.port}/?token=${encodeURIComponent(token)}`,
  };
}

/**
 * @deprecated Use {@link issueSshSession} for the full sessionId + wsUrl flow.
 * Retained for any external/legacy callers; uses DEFAULT_TTL_MS implicitly.
 */
export function issueSshToken(profile: SshProfile): { token: string; wsUrl: string } {
  const { token, wsUrl } = issueSshSession(profile);
  return { token, wsUrl };
}

export function bridgePort(): number {
  return ensure().port;
}

export const SSH_TTL_BOUNDS = { min: MIN_TTL_MS, max: MAX_TTL_MS, default: DEFAULT_TTL_MS } as const;

/**
 * Record a freshly-observed host key. Inserts on first sight; updates the
 * fingerprint + lastSeen if the row already exists (the in-memory cache
 * keeps the bridge from reaching this path on re-connections to a known host).
 */
async function recordHostKey(
  host: string,
  port: number,
  algorithm: string,
  fingerprint: string,
): Promise<void> {
  try {
    const id = randomBytes(8).toString("hex");
    await db
      .insert(sshHostKeys)
      .values({ id, host, port, algorithm, fingerprintSha256: fingerprint })
      .onConflictDoUpdate({
        target: [sshHostKeys.host, sshHostKeys.port],
        set: { algorithm, fingerprintSha256: fingerprint, lastSeenAt: new Date() },
      });
  } catch {
    /* non-fatal */
  }
}

async function touchHostKey(host: string, port: number): Promise<void> {
  try {
    await db
      .update(sshHostKeys)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(sshHostKeys.host, host), eq(sshHostKeys.port, port)));
  } catch {
    /* non-fatal */
  }
}

/**
 * Remove a pinned host key. Use this from the settings UI when the user
 * intentionally rotated the server's key.
 */
export async function forgetSshHostKey(host: string, port: number): Promise<void> {
  ensure().knownHosts.delete(`${host}:${port}`);
  await db.delete(sshHostKeys).where(and(eq(sshHostKeys.host, host), eq(sshHostKeys.port, port)));
}

export function listKnownSshHostKeys(): { host: string; port: number; fingerprint: string }[] {
  const out: { host: string; port: number; fingerprint: string }[] = [];
  for (const [k, fingerprint] of ensure().knownHosts) {
    const idx = k.lastIndexOf(":");
    out.push({ host: k.slice(0, idx), port: Number(k.slice(idx + 1)), fingerprint });
  }
  return out.sort((a, b) => a.host.localeCompare(b.host));
}
