#!/usr/bin/env bash
# vmui — generic foreground launcher for any local-kvm VM.
#
# Selected by the watchdog (watchdog-vm.ps1). Keeps QEMU in the foreground so
# the wsl.exe handle held by the Windows watchdog process remains valid for
# the lifetime of the VM (defeats WSL2 idle-shutdown).
#
# Required env:
#   KIND               mac | win | ubuntu
# Optional env (forwarded to boot-${KIND}.sh):
#   ALLOCATED_RAM CPU_CORES CPU_THREADS VNC_PORT QMP_PORT SSH_FORWARD_PORT
set -u

KIND="${KIND:?KIND env var required (mac|win|ubuntu)}"

case "$KIND" in
  mac)
    VMDIR="${VMDIR:-$HOME/OSX-KVM}"
    BOOT="boot-mac.sh"
    ;;
  win)
    VMDIR="${VMDIR:-$HOME/vmui-vms/win}"
    BOOT="boot-win.sh"
    ;;
  ubuntu)
    VMDIR="${VMDIR:-$HOME/vmui-vms/ubuntu}"
    BOOT="boot-ubuntu.sh"
    ;;
  *)
    echo "ERROR: unsupported KIND=$KIND (expected mac|win|ubuntu)" >&2
    exit 2
    ;;
esac

mkdir -p "$VMDIR"
cd "$VMDIR" || { echo "ERROR: cannot cd to $VMDIR" >&2; exit 1; }

# Always re-sync the boot script from the vmui repo on the Windows side so
# edits to scripts/boot-*.sh take effect on next launch without manual cp.
REPO_SCRIPTS="/mnt/e/gh/vmui/scripts"
if [ -f "$REPO_SCRIPTS/$BOOT" ]; then
  cp "$REPO_SCRIPTS/$BOOT" "./$BOOT"
  chmod +x "./$BOOT"
fi

# Stale runtime files from previous run.
rm -f "/tmp/vmui-${KIND}.pid" "/tmp/vmui-${KIND}.log" "/tmp/vmui-${KIND}.qemu.log"

# Foreground exec — stdout/stderr captured to a per-kind log so the watchdog's
# tail can show progress in the VS Code task panel.
exec ./"$BOOT" > "/tmp/vmui-${KIND}.log" 2>&1 < /dev/null
