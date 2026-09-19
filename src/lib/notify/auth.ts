import { getCurrentUser } from "@/lib/auth";
import { deviceFromRequest } from "@/lib/devices/pairing";
import { espAuthorized } from "@/lib/esp/auth";
import "server-only";

/** Who is acting: signed-in web user, a paired device, or the desktop app with the shared token. */
export async function notifyActor(req: Request): Promise<{ by: string; deviceId: string | null } | null> {
  const d = await deviceFromRequest(req);
  if (d) return { by: `device:${d.name}`, deviceId: d.id };
  const u = await getCurrentUser().catch(() => null);
  if (u) return { by: u.email, deviceId: null };
  if (espAuthorized(req)) return { by: "desktop", deviceId: "desktop" };
  return null;
}
