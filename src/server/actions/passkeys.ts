"use server";

import "server-only";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, passkeys, type PasskeyRow } from "@/lib/db/schema";
import { getCurrentUser, issueSessionForUser } from "@/lib/auth";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  consumeChallenge,
  rememberChallenge,
  verifyAuthentication,
  verifyRegistration,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@/lib/webauthn";

export interface PasskeySummary {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listPasskeysAction(): Promise<PasskeySummary[]> {
  const me = await getCurrentUser();
  if (!me) return [];
  const rows = await db.select().from(passkeys).where(eq(passkeys.userId, me.id));
  return rows
    .map((r) => ({ id: r.id, label: r.label, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function startPasskeyRegistrationAction(): Promise<
  { ok: true; options: unknown; challengeKey: string } | { ok: false; error: string }
> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not authenticated" };
  const existing = await db.select().from(passkeys).where(eq(passkeys.userId, me.id));
  const options = await buildRegistrationOptions({
    userId: me.id,
    email: me.email,
    displayName: me.displayName,
    excludeCredentialIds: existing.map((p) => p.credentialId),
  });
  const challengeKey = nanoid();
  rememberChallenge(challengeKey, options.challenge, me.id);
  return { ok: true, options, challengeKey };
}

export async function finishPasskeyRegistrationAction(input: {
  challengeKey: string;
  label: string;
  response: RegistrationResponseJSON;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not authenticated" };
  const pending = consumeChallenge(input.challengeKey);
  if (!pending || pending.userId !== me.id) {
    return { ok: false, error: "Challenge expired or invalid" };
  }
  const label = input.label.trim().slice(0, 60) || "Passkey";
  try {
    const verification = await verifyRegistration({
      response: input.response,
      expectedChallenge: pending.challenge,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return { ok: false, error: "Verification failed" };
    }
    const info = verification.registrationInfo;
    const credentialID = info.credential.id;
    const publicKeyB64 = Buffer.from(info.credential.publicKey).toString("base64url");
    await db.insert(passkeys).values({
      id: nanoid(),
      userId: me.id,
      credentialId: credentialID,
      publicKey: publicKeyB64,
      counter: info.credential.counter ?? 0,
      transports: input.response.response.transports?.join(",") ?? null,
      label,
    });
    await db.insert(auditLog).values({
      action: "passkey.register",
      target: me.id,
      status: "ok",
      message: label,
    });
    revalidatePath("/settings/users");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Registration failed" };
  }
}

export async function deletePasskeyAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Not authenticated" };
  const row: PasskeyRow | undefined = (
    await db.select().from(passkeys).where(eq(passkeys.id, id)).limit(1)
  )[0];
  if (!row || row.userId !== me.id) return { ok: false, error: "Passkey not found" };
  await db.delete(passkeys).where(eq(passkeys.id, id));
  await db.insert(auditLog).values({
    action: "passkey.delete",
    target: me.id,
    status: "ok",
    message: row.label,
  });
  revalidatePath("/settings/users");
  return { ok: true };
}

export async function startPasskeyAuthenticationAction(): Promise<
  { ok: true; options: unknown; challengeKey: string } | { ok: false; error: string }
> {
  // Allow-list everyone's credentials: this is local-first; user-pick by email
  // doesn't help when the OS already binds passkeys to users.
  const all = await db.select().from(passkeys);
  if (all.length === 0) return { ok: false, error: "No passkeys registered yet" };
  const options = await buildAuthenticationOptions({
    allowCredentialIds: all.map((p) => p.credentialId),
  });
  const challengeKey = nanoid();
  rememberChallenge(challengeKey, options.challenge);
  return { ok: true, options, challengeKey };
}

export async function finishPasskeyAuthenticationAction(input: {
  challengeKey: string;
  response: AuthenticationResponseJSON;
}): Promise<{ ok: boolean; error?: string }> {
  const pending = consumeChallenge(input.challengeKey);
  if (!pending) return { ok: false, error: "Challenge expired" };
  const credentialId = input.response.id;
  const row: PasskeyRow | undefined = (
    await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1)
  )[0];
  if (!row) return { ok: false, error: "Unknown passkey" };
  try {
    const transports = row.transports
      ? (row.transports.split(",").filter(Boolean) as Parameters<typeof verifyAuthentication>[0]["transports"])
      : undefined;
    const verification = await verifyAuthentication({
      response: input.response,
      expectedChallenge: pending.challenge,
      credentialId: row.credentialId,
      publicKey: row.publicKey,
      counter: row.counter,
      transports,
    });
    if (!verification.verified) return { ok: false, error: "Verification failed" };
    await db
      .update(passkeys)
      .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(passkeys.id, row.id));

    // Issue a session for the owner user (passkey bypasses TOTP — possession
    // of the authenticator is already a second factor).
    await issueSessionForUser(row.userId);
    await db.insert(auditLog).values({
      action: "auth.signin.passkey",
      target: row.userId,
      status: "ok",
      message: row.label,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Verification failed" };
  }
}
