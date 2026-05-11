import "server-only";
import { mkdirSync, createWriteStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { terminalRecordings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * asciinema cast v2 recorder.
 * https://docs.asciinema.org/manual/asciicast/v2/
 *
 * On open(): writes the header JSON. on data(): appends one event line per
 * write `[elapsedSec, "o", utf8text]`. on close(): updates the DB row with
 * final duration + size.
 */

const RECORDINGS_DIR = resolve(process.cwd(), "data", "recordings");

export class Recorder {
  readonly id: string;
  readonly path: string;
  private stream: import("node:fs").WriteStream;
  private startMs: number;
  private bytesWritten = 0;
  private closed = false;

  constructor(opts: { sessionId: string; userId?: string | null; instanceLabel?: string | null; cols: number; rows: number }) {
    try { mkdirSync(RECORDINGS_DIR, { recursive: true }); } catch { /* ignore */ }
    this.id = randomBytes(8).toString("hex");
    this.path = resolve(RECORDINGS_DIR, `${this.id}.cast`);
    this.startMs = Date.now();
    this.stream = createWriteStream(this.path, { flags: "w", encoding: "utf-8" });
    const header = {
      version: 2,
      width: opts.cols,
      height: opts.rows,
      timestamp: Math.floor(this.startMs / 1000),
      env: { SHELL: "/bin/bash", TERM: "xterm-256color" },
      title: opts.instanceLabel ?? opts.sessionId,
    };
    const line = JSON.stringify(header) + "\n";
    this.stream.write(line);
    this.bytesWritten += Buffer.byteLength(line);

    try {
      db.insert(terminalRecordings).values({
        id: this.id,
        sessionId: opts.sessionId,
        instanceLabel: opts.instanceLabel ?? null,
        userId: opts.userId ?? null,
        path: this.path,
        cols: opts.cols,
        rows: opts.rows,
      }).run();
    } catch {
      /* DB write must never break terminal */
    }
  }

  writeOutput(buf: Buffer | string): void {
    if (this.closed) return;
    const t = (Date.now() - this.startMs) / 1000;
    const text = typeof buf === "string" ? buf : buf.toString("utf-8");
    const line = JSON.stringify([t, "o", text]) + "\n";
    try {
      this.stream.write(line);
      this.bytesWritten += Buffer.byteLength(line);
    } catch {
      /* ignore */
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.stream.end(); } catch { /* ignore */ }
    const duration = Date.now() - this.startMs;
    let size = this.bytesWritten;
    try { size = statSync(this.path).size; } catch { /* ignore */ }
    try {
      db.update(terminalRecordings)
        .set({ durationMs: duration, sizeBytes: size })
        .where(eq(terminalRecordings.id, this.id))
        .run();
    } catch {
      /* ignore */
    }
  }
}
