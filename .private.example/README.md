# Local guest credentials

`vmui` drives local VMs over SSH without a human present, so the scripts need a
password. This repo is **public**, so those passwords must not be committed.

## Setup

```bash
mkdir -p .private
cp .private.example/credentials.env .private/credentials.env
# edit .private/credentials.env and set the real values
```

`.private/` is gitignored. Nothing inside it is ever committed.

## How scripts read it

| Language   | Usage                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| bash       | `source "$(dirname "$0")/lib/guest-credentials.sh"` → `$MAC_GUEST_PASS`   |
| PowerShell | `. "$PSScriptRoot\lib\guest-credentials.ps1"` → `Get-VmuiGuestCredential` |

Lookup order (first hit wins):

1. `$VMUI_CREDENTIALS_FILE` if set
2. `<repo>/.private/credentials.env`
3. `/mnt/e/gh/vmui/.private/credentials.env` (for scripts copied into WSL)
4. `~/.vmui/credentials.env`

An environment variable that is **already set** is never overwritten, so you can
override a single value for one run:

```bash
MAC_GUEST_PASS='...' ./scripts/mac-perf-tune.sh
```

## Rules

- Never echo a password into terminal output — session logs persist.
- Never paste one into a commit message, doc, or issue.
- These unlock only VMs bound to `127.0.0.1`, but treat them as real credentials.
- If a value leaks, change it **in the guest** as well as here; removing it from
  git history alone does not invalidate it.
