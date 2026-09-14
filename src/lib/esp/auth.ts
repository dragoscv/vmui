import { credential } from "@/lib/home/credentials";
import { timingSafeEqual } from "node:crypto";
import "server-only";

// The ESP cannot hold a vmui session cookie, so its two endpoints use a
// shared secret from .private/credentials.env (ESP_DISPLAY_TOKEN), passed as
// ?k=. LAN-only in practice (127.0.0.1 upstream is fronted by Caddy on the
// tailnet IP and by the Hyper-V switch IP for the ESP).
export function espAuthorized(req: Request): boolean {
  const want = credential("ESP_DISPLAY_TOKEN");
  if (!want) return false;
  const got = new URL(req.url).searchParams.get("k") ?? req.headers.get("x-esp-token") ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
