# vmui — Mac VM watchdog
#
# Runs the macOS QEMU VM in WSL Ubuntu-24.04 and auto-restarts if it exits.
# IMPORTANT: this script must keep running in the foreground (or as a hidden
# background process via Start-Process) — the WSL handle it holds is what
# prevents WSL2 from idle-shutting the distro and killing QEMU.
#
# Usage (foreground, with logs):
#   pwsh -File scripts\watchdog-mac.ps1
#
# Usage (hidden background):
#   Start-Process -WindowStyle Hidden pwsh -ArgumentList '-File','scripts\watchdog-mac.ps1'
#
# Stop: kill all wsl.exe / qemu-system-x86_64 processes, or close the window.

param(
  [string]$Distro = "Ubuntu-24.04",
  [int]$AllocatedRamMb = 16384,
  [int]$Cores = 4,
  [int]$Threads = 8,
  [int]$VncDisplay = 0,
  [int]$QmpPort = 4444,
  [int]$SshPort = 10022,
  [int]$RestartDelaySec = 5,
  [int]$MaxRestarts = 0  # 0 = unlimited
)

$ErrorActionPreference = "Continue"
$logDir = Join-Path $PSScriptRoot "..\.watchdog-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("watchdog-{0:yyyyMMdd}.log" -f (Get-Date))

function Write-Log {
  param([string]$Message)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$ts] $Message"
  $line | Out-File -FilePath $logFile -Append -Encoding utf8
  # Also mirror to stdout so the VS Code task terminal shows progress.
  Write-Host $line
}

Write-Log "Watchdog start: distro=$Distro ram=${AllocatedRamMb} cores=$Cores threads=$Threads vnc=:$VncDisplay qmp=$QmpPort ssh=$SshPort"

# We launch run-mac-foreground.sh inside WSL with the env vars boot-mac.sh
# expects. The runner re-syncs boot-mac.sh from the repo on each launch so
# dev-time edits take effect on next restart.
#
# We also sync run-mac-foreground.sh itself from /mnt/e/gh/vmui/scripts on
# each iteration so this script is self-sufficient when launched directly
# from the VS Code task (without going through the web UI's Server Action,
# which previously did the sync). Falls back gracefully if the mount path
# isn't available.
$syncCmd = "if [ -f /mnt/e/gh/vmui/scripts/run-mac-foreground.sh ]; then cp /mnt/e/gh/vmui/scripts/run-mac-foreground.sh /tmp/run-mac-foreground.sh && chmod +x /tmp/run-mac-foreground.sh; fi"
# Pre-flight cleanup of stale qemu-nbd / mounts that hold the OpenCore image
# write-lock (e.g. from a crashed UIScale patch run). Without this, QEMU
# fails immediately with "Failed to get shared 'write' lock" and the
# watchdog spins in a tight restart loop.
$nbdCleanup = "sudo umount -l /tmp/vmui-oc-mnt 2>/dev/null; sudo qemu-nbd -d /dev/nbd0 2>/dev/null; true"
$bashCmd = "$syncCmd; $nbdCleanup; ALLOCATED_RAM=$AllocatedRamMb CPU_CORES=$Cores CPU_THREADS=$Threads VNC_PORT=$VncDisplay QMP_PORT=$QmpPort SSH_FORWARD_PORT=$SshPort exec bash /tmp/run-mac-foreground.sh"

$restarts = 0
while ($true) {
  Write-Log "Launching QEMU (attempt $($restarts + 1))..."

  # Foreground wsl.exe — this PowerShell holds the WSL handle so the distro
  # cannot idle-shut.
  & wsl.exe -d $Distro -- bash -lc $bashCmd
  $exitCode = $LASTEXITCODE

  Write-Log "QEMU exited (code=$exitCode). Sleeping ${RestartDelaySec}s before restart..."

  $restarts++
  if ($MaxRestarts -gt 0 -and $restarts -ge $MaxRestarts) {
    Write-Log "Reached max restarts ($MaxRestarts). Exiting watchdog."
    break
  }

  Start-Sleep -Seconds $RestartDelaySec
}
