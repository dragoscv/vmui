import { createSocket } from "node:dgram";
import "server-only";

/** Fire a per-LED notification on the DX Light strip.
 *  The animator lives in the ambilight bridge process (ambilight/notify_fx.py,
 *  UDP 19460 on loopback) because only one process may hold the strip's HID
 *  handle. Fire-and-forget: a dead bridge must never fail a Copilot hook. */
const FX_PORT = 19460;

export function stripFx(event: "ask" | "done" | "blocked" | "failed" | "clear", color?: string, duration?: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createSocket("udp4");
    const msg = Buffer.from(JSON.stringify({ event, color, duration }));
    sock.send(msg, FX_PORT, "127.0.0.1", (err) => {
      sock.close();
      resolve(!err);
    });
  });
}
