import "server-only";
import { z } from "zod";

const schema = z.object({
  VMUI_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "VMUI_MASTER_KEY must be a 64-char hex string (32 bytes). Run `pnpm keygen`.")
    .optional(),
  VMUI_DB_PATH: z.string().min(1).default("./vmui.db"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = schema.safeParse({
  VMUI_MASTER_KEY: process.env.VMUI_MASTER_KEY,
  VMUI_DB_PATH: process.env.VMUI_DB_PATH,
  NODE_ENV: process.env.NODE_ENV,
});

if (!parsed.success) {
  // Surface a useful message but don't crash on import for keygen workflow
  console.warn("[vmui] env validation issue:", parsed.error.issues.map((i) => i.message).join("; "));
}

export const env = parsed.success
  ? parsed.data
  : {
      VMUI_MASTER_KEY: process.env.VMUI_MASTER_KEY,
      VMUI_DB_PATH: process.env.VMUI_DB_PATH ?? "./vmui.db",
      NODE_ENV: (process.env.NODE_ENV ?? "development") as "development" | "production" | "test",
    };

export function requireMasterKey(): Buffer {
  const k = env.VMUI_MASTER_KEY;
  if (!k) {
    throw new Error(
      "VMUI_MASTER_KEY not set. Generate one with `pnpm keygen` and add it to .env",
    );
  }
  return Buffer.from(k, "hex");
}
