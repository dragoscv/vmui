import "server-only";
import { Client as SshClient } from "ssh2";
import type { ProbeKey } from "@/lib/probe";

export interface SshExecOptions {
  host: string;
  port: number;
  user: string;
  key: ProbeKey;
  command: string;
  /** Hard timeout in ms. Default 15000. */
  timeoutMs?: number;
}

export interface SshExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run a single command over SSH and return stdout/stderr/exit code. Does not
 * allocate a pty, so output is clean (no ANSI). Returns even on non-zero exit;
 * only rejects on connect/timeout/transport errors.
 */
export function sshExec(opts: SshExecOptions): Promise<SshExecResult> {
  return new Promise<SshExecResult>((resolve, reject) => {
    const conn = new SshClient();
    let timer: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        conn.end();
      } catch {
        /* ignore */
      }
    };
    conn.on("ready", () => {
      conn.exec(opts.command, (err, stream) => {
        if (err) {
          cleanup();
          reject(err);
          return;
        }
        let stdout = "";
        let stderr = "";
        stream
          .on("close", (code: number) => {
            cleanup();
            resolve({ stdout, stderr, code: typeof code === "number" ? code : 0 });
          })
          .on("data", (d: Buffer) => {
            stdout += d.toString("utf8");
          });
        stream.stderr.on("data", (d: Buffer) => {
          stderr += d.toString("utf8");
        });
      });
    });
    conn.on("error", (err) => {
      cleanup();
      reject(err);
    });
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`ssh exec timeout (${opts.timeoutMs ?? 15000}ms)`));
    }, opts.timeoutMs ?? 15_000);
    conn.connect({
      host: opts.host,
      port: opts.port,
      username: opts.user,
      privateKey: opts.key.privateKey,
      passphrase: opts.key.passphrase,
      readyTimeout: 8_000,
    });
  });
}
