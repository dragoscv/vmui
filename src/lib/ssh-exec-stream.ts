import "server-only";
import { Client as SshClient, type ClientChannel } from "ssh2";
import type { ProbeKey } from "@/lib/probe";

export interface SshStreamHandle {
  stop(): void;
}

export interface SshStreamOptions {
  host: string;
  port: number;
  user: string;
  key: ProbeKey;
  command: string;
  onChunk: (text: string) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export function startSshStream(opts: SshStreamOptions): SshStreamHandle {
  const conn = new SshClient();
  let stream: ClientChannel | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      stream?.signal("TERM");
    } catch {
      /* ignore */
    }
    try {
      stream?.close();
    } catch {
      /* ignore */
    }
    try {
      conn.end();
    } catch {
      /* ignore */
    }
  };

  conn.on("ready", () => {
    conn.exec(opts.command, { pty: true }, (err, ch) => {
      if (err) {
        opts.onError(err.message);
        stop();
        opts.onClose();
        return;
      }
      stream = ch;
      ch.on("data", (d: Buffer) => {
        if (!stopped) opts.onChunk(d.toString("utf8"));
      });
      ch.stderr.on("data", (d: Buffer) => {
        if (!stopped) opts.onChunk(d.toString("utf8"));
      });
      ch.on("close", () => {
        stop();
        opts.onClose();
      });
    });
  });

  conn.on("error", (err: Error) => {
    opts.onError(err.message);
    stop();
    opts.onClose();
  });

  conn.connect({
    host: opts.host,
    port: opts.port,
    username: opts.user,
    privateKey: opts.key.privateKey,
    passphrase: opts.key.passphrase,
    readyTimeout: 8_000,
  });

  return { stop };
}
