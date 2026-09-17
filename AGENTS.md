# vmui — Repository guide for AI agents

vmui is a local-first multi-cloud VM control plane. Single-tenant, single-host, no SaaS dependency. Runs at `127.0.0.1:3737` for the app, `127.0.0.1:3738` for the SSH WebSocket bridge.

## Stack

- **Framework**: Next.js 16 App Router, React 19.2, TypeScript 5.9 strict (`noUncheckedIndexedAccess`).
- **DB**: SQLite via `better-sqlite3` + Drizzle ORM. Schema is the source of truth in [src/lib/db/schema.ts](src/lib/db/schema.ts); raw `CREATE TABLE` bootstrap and `PRAGMA table_info` column-add migrations live in [src/lib/db/index.ts](src/lib/db/index.ts).
- **Crypto**: AES-256-GCM via `VMUI_MASTER_KEY` (env, base64). Helpers `encryptJSON` / `decryptJSON` in [src/lib/crypto.ts](src/lib/crypto.ts). Never log decrypted payloads.
- **Styling**: Tailwind v4 CSS-first config (`@theme` in [src/app/globals.css](src/app/globals.css)). Tokens use oklch. No `tailwind.config.js`.
- **UI**: shadcn-style components in [src/components/ui/](src/components/ui/). Lucide icons. Sonner for toasts. Motion for animation.
- **Forms**: prefer `useActionState` + zod-validated server action. React Hook Form only for complex multi-step flows.
- **Pricing**: static curated table + Azure Retail Prices live API; cached in `pricing_cache` with 24h TTL.
- **SSH bridge**: ws + ssh2 singleton on `globalThis.__vmuiSshBridge`; binary frames are stdin/stdout, JSON frames are control messages (`resize`, `ready`, `error`, `close`). Single-use 60s tokens.

## Cloud providers

Implemented in [src/lib/providers/](src/lib/providers/) with the `CloudProvider` interface from [types.ts](src/lib/providers/types.ts):

| Provider  | Instances            | Resources                                                                | Create-VM                                 | Notes                                                                                                          |
| --------- | -------------------- | ------------------------------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AWS       | full                 | volume / snapshot / sg / keypair / vpc / subnet / bucket / db / lb / dns | full (incl. Mac dedicated host)           | Uses `@aws-sdk/client-*` v3.10x                                                                                |
| Azure     | full                 | disks / snapshots / vnets / subnets / NSGs / load-balancers              | full (auto-RG/VNet/Subnet/PIP/NIC)        | `@azure/identity` + `arm-compute` + `arm-network` + `arm-resources-subscriptions` (NOT `arm-subscriptions` v6) |
| GCP       | full                 | disks / snapshots / networks / subnets / firewalls / images              | full (image families + ssh-keys metadata) | `@google-cloud/compute` v6; aggregatedListAsync is `for-await`                                                 |
| Scaleway  | bare-metal Mac minis | n/a (no resource graph)                                                  | full                                      | REST via fetch; 24h minimum lease                                                                              |
| local-kvm | full                 | n/a                                                                      | full                                      | qemu/QMP under the hood                                                                                        |

`local-kvm` also carries the Hyper-V kinds `hyperv-win` and `hyperv-haos`
(Home Assistant OS). They share every lifecycle branch via `isHyperV` /
`HYPERV_KINDS` in [local-kvm.ts](src/lib/providers/local-kvm.ts) — adding a
Hyper-V kind means adding it to that list, its `KIND_DEFAULTS`, the Zod enum
in `actions/accounts.ts`, and the UI card. Operations for the appliance live
in `scripts/homeassistant.ps1` + `scripts/ha-configure.ps1`; read
[docs/home-assistant.md](docs/home-assistant.md) before touching it — its
traps section is the list of things that took the instance down.

VM ids:

- AWS: `i-…` (raw EC2 instance id).
- Azure: `{resourceGroup}/{name}` short form.
- GCP: `{zone}/{name}` short form.
- Scaleway: provider UUID.
- local-kvm: synthetic.

Synthetic DB id is always `${accountId}:${region}:${providerInstanceId}`.

## Multi-region sync

- `cloud_accounts.regions` is a JSON-encoded `string[]`; `null` falls back to `defaultRegion`.
- `parseRegions(json, fallback)` helpers exist in both [actions/instances.ts](src/server/actions/instances.ts) and [actions/resources.ts](src/server/actions/resources.ts) — keep them in sync.
- Region picker UI: [account-regions-editor.tsx](src/components/accounts/account-regions-editor.tsx) backed by [REGION_CATALOG](src/lib/providers/regions.ts).
- Sync iterates regions in `Promise.all`; per-region failures are audit-logged, never thrown.

## Conventions

- **No comments unless WHY is non-obvious.** No PR-history comments ("added for X").
- Use `?? defaultValue` for `noUncheckedIndexedAccess` array/object index access.
- Server-side files start with `import "server-only";`. Test stub at [test/stubs/server-only.ts](test/stubs/server-only.ts).
- Never call `revalidatePath` from a query module — only from server actions.
- Audit log every mutation: `db.insert(auditLog).values({ accountId, action, target, status, message })`.
- File path convention in `actions/`: `{domain}.ts` colocated, all marked `"use server"` at the top.
- Agent-facing actions live in ONE place: [src/lib/mcp/tools.ts](src/lib/mcp/tools.ts) (served by `/api/mcp`, bearer `vmui_*` operator). Adding a house/PC capability means adding a tool there (zod schema, description a model can act on, `destructive`/`readOnly` flags) — not a new ad-hoc route. PC verbs are the fixed enum in `scripts/pc-action.ps1`; never expose arbitrary shell.

## Native modules

`next.config.ts` lists `serverExternalPackages: ["better-sqlite3", "ssh2", "cpu-features", "ws"]`. Adding any new native binding (e.g. `node-pty`) means adding it here too — otherwise Turbopack tries to bundle it and breaks at runtime.

## Scripts

## Deployment target: homepi (Raspberry Pi 4B)

The production vmui, Home Assistant, ESPHome, Mosquitto, the Turzx renderer
and the desk button run on `homepi` (`192.168.100.232`, `ssh homepi`). Build
here, ship with `pwsh -File scripts\pi-deploy.ps1` (never `pnpm build` on the
Pi — 4 GB RAM). Units and compose live in `pi/`; read the "homepi" section of
[docs/home-assistant.md](docs/home-assistant.md) before touching them. The
vmui instance on this PC only serves the Hyper-V `local-kvm` provider.

- `pnpm dev` — Next dev on `127.0.0.1:3737`.
- `pnpm build` / `pnpm start` — production.
- `pnpm typecheck` — `tsc --noEmit`. Run before declaring a round done.
- `pnpm test` — Vitest unit tests.
- `pnpm test:e2e` — Playwright. Auto-spawns dev server.
- `pnpm db:studio` — Drizzle Studio.
- `pnpm keygen` — generates a fresh `VMUI_MASTER_KEY`.

## Don't

- Don't import from `@azure/arm-subscriptions` (v6 renamed). Use `@azure/arm-resources-subscriptions`.
- Don't iterate `aggregatedListAsync` with `.next()` — it's an `AsyncIterable`, use `for await ... break`.
- Don't add markdown docs unless explicitly requested.
- Don't add backwards-compat shims; we own the whole stack.
- Don't use `process.env.X` in client components — go through [src/lib/env.ts](src/lib/env.ts).

## When in doubt

- Check the `audit_log` for what ran last and how it failed: `pnpm db:studio` → `audit_log`.
- Check [README.md](README.md) for user-facing setup; this file is for agents.
