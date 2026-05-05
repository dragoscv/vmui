# vmui

> A beautiful, multi-cloud virtual machine control plane that runs entirely on your laptop.

vmui is a local-first web app for managing VMs across AWS (today) and Azure / GCP (next). Connect cloud accounts, browse instances, start/stop/reboot/terminate them, and **connect** with one click — vmui generates an `.rdp` file for Windows, an SSH command + VNC tunnel for macOS EC2 Mac instances, and an SSH command for Linux.

## Features

- **One-click VM control** — start, stop, reboot, terminate
- **Smart Connect** — `.rdp` for Windows, SSH+VNC for macOS, SSH for Linux
- **macOS on AWS** — handles Dedicated Host allocation automatically
- **Background sync** — auto-refreshes status every 15s while you watch
- **Animated, modern UI** — Tailwind v4, motion (framer), View Transitions, glass surfaces, dark/light themes
- **Encrypted credentials** — AES-256-GCM at rest, master key never leaves your machine
- **Local-first** — SQLite, listens on `127.0.0.1` only, no telemetry

## Tech stack

- Next.js 16 (App Router, Server Actions, React Compiler, Turbopack)
- React 19.2 + TypeScript 5.9 strict
- Tailwind CSS v4 (CSS-first `@theme`) + Radix primitives + lucide-react + motion
- Drizzle ORM + better-sqlite3
- AWS SDK for JavaScript v3 (`@aws-sdk/client-ec2`, `@aws-sdk/client-sts`)
- Zod for validation, Sonner for toasts, TanStack Query for client cache

## Quick start

```powershell
# 1. Install deps
pnpm install

# 2. Generate a master encryption key
pnpm keygen
# Copy the printed line into .env (create from .env.example)

# 3. Start the app on http://127.0.0.1:3737
pnpm dev
```

Open http://127.0.0.1:3737 in your browser.

### Connecting an AWS account

You need an IAM user (or temporary STS credentials from `aws sso login`) with **EC2 Full Access** + **STS GetCallerIdentity**. Paste the access key into the in-app **Add account** form. vmui will:

1. Verify the credentials with `sts:GetCallerIdentity`
2. Encrypt them with your local master key
3. Sync instances from the default region every 15 seconds

If you'd rather create a dedicated IAM user from the CLI, paste this in your shell after `aws configure --profile vmui`:

```powershell
aws iam create-user --user-name vmui-controller
aws iam attach-user-policy --user-name vmui-controller `
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2FullAccess
aws iam create-access-key --user-name vmui-controller
```

### Launching a macOS instance

Pick **macOS Sonoma (Apple Silicon)** in the create wizard. vmui will:

1. Find or **allocate a Dedicated Host** for the chosen Mac instance type
2. Resolve the latest macOS AMI via SSM public parameters
3. Run the instance and tag it `vmui:managed=true`

> ⚠️ AWS Mac dedicated hosts have a **24-hour minimum allocation**. mac2.metal is ~$6.50/hr.

To get the GUI, click **Connect** on the macOS instance card. vmui shows you the SSH tunnel command and a `vnc://localhost:5900` URL — paste the SSH command in a terminal first, then ⌘K → connect-to-server in Finder.

### Launching a Windows instance

Pick **Windows Server 2022**. After it's running, click **Connect** and download the generated `.rdp` file. Microsoft Remote Desktop will open it. Get the Administrator password from the EC2 console (Connect → RDP client → Get password) using your private key.

## Project layout

```
src/
  app/                       # Next.js App Router (pages + layout)
    page.tsx                 # Dashboard
    accounts/                # Account management
    instances/[id]/          # VM detail page
    instances/new/           # Create wizard
    activity/                # Audit log
  components/
    nav/                     # Sidebar, topbar
    instances/               # Cards, actions, connect dialog, background sync
    accounts/                # Account form
    ui/                      # shadcn-style primitives
  lib/
    db/                      # Drizzle schema + better-sqlite3 client
    providers/               # Cloud provider abstraction + AWS impl
    crypto.ts                # AES-256-GCM helpers
    env.ts                   # zod-validated env
  server/
    actions/                 # Server actions (mutations)
    queries/                 # Read-side (RSC)
```

## Adding a new provider

Implement `CloudProvider` from `src/lib/providers/types.ts` and register it in `src/lib/providers/registry.ts`. The dashboard, status badges, and connect dialog are provider-agnostic.

## Local KVM (macOS in WSL2)

See [docs/local-kvm-macos.md](docs/local-kvm-macos.md) for architecture, the
two start paths (web UI vs VS Code task), QEMU 8.2 compatibility notes, and
the HiDPI / "everything is huge" fix using `displayplacer` + a LaunchAgent.

## Security notes

- vmui binds to `127.0.0.1` only — change ports/host with care
- Cloud credentials live in SQLite encrypted with AES-256-GCM (auth tag verified)
- Lose `VMUI_MASTER_KEY`? Re-add your accounts; the encrypted blobs become unreadable
- Never commit `.env` or `vmui.db`

## Roadmap

- Azure & GCP providers (interface ready)
- AWS SSO / IAM Identity Center login flow
- Inline cost estimates per template
- WebSocket-based live status (replace 15s polling)
- Bulk actions, search, tags
- Export `.rdp` per region in batch

## License

MIT
