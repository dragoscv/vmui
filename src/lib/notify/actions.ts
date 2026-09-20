import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { approveDevice, rejectDevice } from "@/lib/devices/pairing";
import { canOpenDoor, ownerActor, type HomeActor } from "@/lib/home/access";
import { ha } from "@/lib/home/ha-client";
import { NO_CALL } from "@/lib/home/intercom";
import "server-only";
import { msg, type Text } from "./i18n";
import { dismiss, getCard, type Card, type NotifyAction } from "./index";

// A tap on a card button lands here with the card + the action the source
// attached (its `body` is opaque to the client). Everything is routed by
// `kind` so sources never expose arbitrary service calls to the phone.
//
// `actor` is the family member behind the tap (lib/home/access.ts): a bound
// device or a browser session. `undefined` = an unattributed internal caller
// (HA rest_command, shared desktop token) that acts as the owner; `null` = a
// caller we identified but who has no household access.

/** `message` / `error` are language-neutral (`Text`); the API route renders them for the caller with `render()`. */
export type ActResult = { ok: true; message?: Text; card?: Card | null } | { ok: false; error: Text };

class ActError extends Error {
  constructor(public readonly text: Text) {
    super(typeof text === "string" ? text : text.key);
  }
}

const DOOR_ACTIONS = new Set(["open", "arm"]);

export async function runAction(cardId: string, actionId: string, by: string, actor?: HomeActor | null): Promise<ActResult> {
  const card = await getCard(cardId);
  if (!card) return { ok: false, error: msg("errors.cardNotFound") };
  if (card.dismissedAt) return { ok: false, error: msg("errors.alreadyResolved") };
  const action = card.actions.find((a) => a.id === actionId);
  if (!action) return { ok: false, error: msg("errors.unknownAction") };
  if (actionId === "dismiss") return { ok: true, card: await dismiss(card.id, by, "dismiss") };
  const who = actor === undefined ? await ownerActor() : actor;
  if (card.kind === "intercom" && DOOR_ACTIONS.has(actionId) && !(who && canOpenDoor(who))) {
    await db.insert(auditLog).values({ accountId: "notify", action: `notify.act.${card.kind}.${actionId}`, target: card.id, status: "error", message: `${by}: forbidden (${who?.role ?? "no access"})` });
    return { ok: false, error: "forbidden" };
  }
  try {
    const message = await dispatch(card, action, by, who);
    await db.insert(auditLog).values({ accountId: "notify", action: `notify.act.${card.kind}.${actionId}`, target: card.id, status: "ok", message: `${by}: ${message == null ? "" : typeof message === "string" ? message : message.key}`.slice(0, 200) });
    const done = await dismiss(card.id, by, actionId);
    return { ok: true, message, card: done };
  } catch (e) {
    const text: Text = e instanceof ActError ? e.text : e instanceof Error ? e.message : String(e);
    await db.insert(auditLog).values({ accountId: "notify", action: `notify.act.${card.kind}.${actionId}`, target: card.id, status: "error", message: (typeof text === "string" ? text : text.key).slice(0, 200) });
    return { ok: false, error: text };
  }
}

async function dispatch(card: Card, a: NotifyAction, by: string, who: HomeActor | null): Promise<Text | undefined> {
  const b = (a.body ?? {}) as Record<string, unknown>;
  switch (card.kind) {
    case "intercom": {
      const ic = await import("@/lib/home/intercom");
      if (a.id === "open") {
        const r = await ic.openDoor(by);
        if (!r.ok) throw new ActError(r.error === NO_CALL ? msg("errors.noCall") : r.error ?? msg("errors.openFailed"));
        return msg("results.doorOpened");
      }
      if (a.id === "ignore") { await ic.ignoreCall(by); return msg("results.ignored"); }
      break;
    }
    case "pairing": {
      const id = String(b.deviceId ?? "");
      if (a.id === "approve") {
        // the new device acts as the approver; "solo" installs have no user rows to bind to
        const r = await approveDevice(id, String(b.code ?? ""), by, who && who.userId !== "solo" ? who.userId : null);
        if (!r.ok) throw new ActError(msg(`errors.pairing.${r.error}`));
        return msg("results.approved");
      }
      if (a.id === "reject") { await rejectDevice(id, by); return msg("results.rejected"); }
      break;
    }
    case "water": {
      const ml = Number(b.ml ?? 250);
      const { addWater } = await import("@/lib/nutrition/water");
      const { journalUserId, ownerActor } = await import("@/lib/home/access");
      // The water nudge is computed from the owner's journal, so its reply lands there too.
      const o = await ownerActor();
      await addWater(ml, `notify:${by}`, Date.now(), o ? journalUserId(o) : null);
      return msg("results.waterAdded", { ml });
    }
    case "pc": {
      if (a.id === "wake") {
        const { wakePc } = await import("@/lib/home/wol");
        const r = await wakePc(`notify:${by}`);
        if (!r.ok) throw new Error(r.error);
        return msg("results.wakeSent");
      }
      break;
    }
    case "pi": {
      if (a.id === "restart" && typeof b.unit === "string") {
        const { execFile } = await import("node:child_process");
        await new Promise<void>((res, rej) => execFile("sudo", ["-n", "systemctl", "restart", b.unit as string], { timeout: 20000 }, (e) => (e ? rej(e) : res())));
        return msg("results.unitRestarted", { unit: b.unit });
      }
      break;
    }
    case "door":
    case "window":
    case "presence": {
      if (a.id === "lights_off") { await ha.callService("light", "turn_off", { entity_id: "all" }); return msg("results.lightsOff"); }
      if (a.id === "light_on" && typeof b.entity === "string") { await ha.callService("light", "turn_on", { entity_id: b.entity }); return msg("results.lightOn"); }
      break;
    }
    case "copilot":
    case "agents":
      // open-in-codai is a URL action handled on the client; nothing server-side
      return undefined;
    default:
      break;
  }
  throw new ActError(msg("errors.unsupportedAction", { action: a.id, kind: card.kind }));
}
