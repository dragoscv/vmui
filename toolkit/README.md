# vmui Toolkit

A status-bar app for the macOS guest that runs maintenance tools from a menu,
so the `scripts/mac-*.sh` helpers are discoverable instead of tribal knowledge.

Builds with the **Command Line Tools only** — no Xcode, no Apple ID, no signing
certificate. That matters here: this VM cannot sign in to an Apple ID (the
SMBIOS reports a placeholder serial), so anything requiring Xcode is off the
table.

## Install

Run inside the guest:

```bash
bash install.sh              # build, install to /Applications, start at login
bash install.sh --dmg        # also produce a distributable .dmg
bash install.sh --uninstall  # remove everything
```

From the host, in one shot:

```bash
wsl -d Ubuntu-24.04 -- bash -lc '
  . /mnt/e/gh/vmui/scripts/lib/guest-credentials.sh
  sshpass -p "$MAC_GUEST_PASS" scp -P 10022 -r /mnt/e/gh/vmui/toolkit/* \
    "$MAC_GUEST_USER@127.0.0.1:~/vmui-toolkit-src/"
  sshpass -p "$MAC_GUEST_PASS" ssh -p 10022 "$MAC_GUEST_USER@127.0.0.1" \
    "cd ~/vmui-toolkit-src && bash install.sh"'
```

## Adding a tool

Two steps, no Swift:

1. Drop a script in `tools/`.
2. Add an entry to `tools.json`.

```json
{
  "id": "my-tool",
  "title": "Do the thing",
  "section": "System",
  "command": ["$TOOLKIT/my-tool.sh"],
  "confirm": true,
  "notify": true
}
```

Re-run `install.sh` and restart the app. The menu is rebuilt from the manifest
at launch.

| Field         | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `id`          | stable key, also used in the log                                  |
| `section`     | groups items; sections appear in first-seen order                 |
| `command`     | argv array — executed directly, no shell, so no quoting surprises |
| `confirm`     | prompt before running                                             |
| `notify`      | show the output when it finishes (failures always show)           |
| `requires`    | `metal` / `xcode` — unmet items render greyed out                 |
| `unavailable` | tooltip explaining why, shown when `requires` is unmet            |

`$TOOLKIT` expands to the install directory and `$TOOLKIT_LOG` to the log file,
so the manifest stays portable.

## Layout

| Path                 | Role                                                     |
| -------------------- | -------------------------------------------------------- |
| `Sources/main.swift` | the app: reads the manifest, builds the menu, runs tools |
| `tools.json`         | the manifest — the only file you edit to add a tool      |
| `tools/*.sh`         | guest-side implementations                               |
| `install.sh`         | build, bundle, install, register, optional `.dmg`        |

Installed to:

```
/Applications/vmui Toolkit.app
~/Library/Application Support/vmui-toolkit/   # manifest, tools, toolkit.log
~/Library/LaunchAgents/ro.vmui.toolkit.plist  # start at login
```

## Simulators

The iPhone and iPad entries are present but **greyed out**, and will stay that
way on this VM:

```
MTLCreateSystemDefaultDevice() -> NULL   Simulator.app needs Metal (Xcode 11+)
kern.hv_support: 0                       no nested virtualisation
Apple ID accounts: 0                     cannot download Xcode
```

They are wired up rather than omitted so the menu is honest about what is
missing, and so they work unchanged if the VM ever gets a real GPU — that needs
passthrough of a macOS-supported AMD card (RX 580 / RX 6600) from a hypervisor
exposing IOMMU. WSL2 cannot: `/sys/kernel/iommu_groups/` is empty because WSL2
is itself a Hyper-V guest.

## Notes

- The scripts in `tools/` are **guest-local**. The repo's `scripts/mac-*.sh`
  drive the guest over SSH from the host and cannot be called from the menu.
- The `.dmg` is unsigned. Gatekeeper blocks the first launch on another Mac:
  right-click → Open, or
  `xattr -dr com.apple.quarantine "/Applications/vmui Toolkit.app"`.
  Notarising needs a paid Apple Developer account.
- Logs: `~/Library/Application Support/vmui-toolkit/toolkit.log`.
