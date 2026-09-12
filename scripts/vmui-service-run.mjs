// Launched by the `vmui-service` scheduled task (scripts/vmui-service.ps1).
//
// The task action gets a console from the scheduler; in an interactive
// session that console received a Ctrl+C/close ~75 s after start and node died
// with 0xC000013A (STATUS_CONTROL_C_EXIT) — both for a pwsh wrapper and for
// node directly. So this launcher spawns `next start` DETACHED, with no
// console, then exits. The server has nothing left to receive the signal.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const logDir = join(root, ".copilot-tmp", "service-logs");
mkdirSync(logDir, { recursive: true });
const logPath = join(logDir, "vmui.log");
const out = openSync(logPath, "a");

const port = Number(process.env.VMUI_PORT ?? "3737");
// The task also fires every 5 min as a watchdog: exit quietly if already up.
const busy = await new Promise((resolve) => {
  const s = createConnection({ host: "127.0.0.1", port });
  s.once("connect", () => { s.destroy(); resolve(true); });
  s.once("error", () => resolve(false));
});
if (busy) process.exit(0);

const child = spawn(
  process.execPath,
  [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-H", "127.0.0.1", "-p", String(port)],
  { cwd: root, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", out, out], detached: true, windowsHide: true },
);
child.unref();
appendFileSync(logPath, `${new Date().toISOString()} launcher pid=${process.pid} spawned next pid=${child.pid} (detached)\n`);
