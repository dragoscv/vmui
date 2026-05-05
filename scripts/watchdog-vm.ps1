# vmui — generic VM watchdog
#
# Replaces the macOS-specific watchdog-mac.ps1. Drives any of the supported
# guest kinds (mac | win | ubuntu) by delegating to scripts/run-vm-foreground.sh
# inside the named WSL distro.
#
# Why this script must keep running in the foreground (or as a hidden Windows
# process via spawn-watchdog.ps1): the wsl.exe handle it holds is what keeps
# the WSL2 distro alive. Without it, WSL2 idle-shuts the distro after ~60 s
# and kills our QEMU process.
#
# Logs go under .watchdog-logs/ at the repo root.
#
# Usage (foreground, with logs):
#   pwsh -File scripts\watchdog-vm.ps1 -Kind win
#
# Usage (hidden background): use spawn-watchdog.ps1.

param(
  [string]$Distro = "Ubuntu-24.04",
  [ValidateSet("mac","win","ubuntu")]
  [string]$Kind = "mac",
  [int]$AllocatedRamMb = 0,    # 0 = use kind default
  [int]$Cores = 0,
  [int]$Threads = 0,
  [int]$VncDisplay = -1,       # -1 = use kind default; QEMU adds 5900 to display
  [int]$QmpPort = 0,
  [int]$SshPort = 0,
  [int]$RestartDelaySec = 5,
  [int]$MaxRestarts = 0        # 0 = unlimited
)

$ErrorActionPreference = "Continue"
$logDir = Join-Path $PSScriptRoot "..\.watchdog-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("watchdog-{0}-{1:yyyyMMdd}.log" -f $Kind, (Get-Date))

function Write-Log {
  param([string]$Message)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$ts] [$Kind] $Message"
  $line | Out-File -FilePath $logFile -Append -Encoding utf8
  Write-Host $line
}

# Per-kind defaults — keep in sync with src/lib/providers/local-kvm.ts.
switch ($Kind) {
  "mac" {
    if ($AllocatedRamMb -le 0) { $AllocatedRamMb = 16384 }
    if ($Cores -le 0)          { $Cores = 4 }
    if ($Threads -le 0)        { $Threads = 8 }
    if ($VncDisplay -lt 0)     { $VncDisplay = 0 }       # host 5900
    if ($QmpPort -le 0)        { $QmpPort = 4444 }
    if ($SshPort -le 0)        { $SshPort = 10022 }
  }
  "win" {
    if ($AllocatedRamMb -le 0) { $AllocatedRamMb = 8192 }
    if ($Cores -le 0)          { $Cores = 4 }
    if ($Threads -le 0)        { $Threads = 8 }
    if ($VncDisplay -lt 0)     { $VncDisplay = 1000 }    # host 6900
    if ($QmpPort -le 0)        { $QmpPort = 4445 }
    if ($SshPort -le 0)        { $SshPort = 10023 }
  }
  "ubuntu" {
    if ($AllocatedRamMb -le 0) { $AllocatedRamMb = 4096 }
    if ($Cores -le 0)          { $Cores = 2 }
    if ($Threads -le 0)        { $Threads = 4 }
    if ($VncDisplay -lt 0)     { $VncDisplay = 2000 }    # host 7900
    if ($QmpPort -le 0)        { $QmpPort = 4446 }
    if ($SshPort -le 0)        { $SshPort = 10024 }
  }
}

Write-Log "Watchdog start: distro=$Distro kind=$Kind ram=${AllocatedRamMb} cores=$Cores threads=$Threads vnc=:$VncDisplay qmp=$QmpPort ssh=$SshPort"

# Sync the runner from /mnt/e/gh/vmui/scripts (Windows-side repo) into /tmp
# inside WSL so the watchdog is self-sufficient even when launched directly
# from the VS Code task (no Server Action sync involved).
$syncCmd = "if [ -f /mnt/e/gh/vmui/scripts/run-vm-foreground.sh ]; then cp /mnt/e/gh/vmui/scripts/run-vm-foreground.sh /tmp/run-vm-foreground.sh && chmod +x /tmp/run-vm-foreground.sh; fi"

# macOS-specific cleanup of stale qemu-nbd / mounts that hold the OpenCore
# image write-lock (otherwise QEMU fails with "Failed to get shared 'write'
# lock" and the watchdog spins). No-op on win/ubuntu.
$nbdCleanup = "true"
if ($Kind -eq "mac") {
  $nbdCleanup = "sudo umount -l /tmp/vmui-oc-mnt 2>/dev/null; sudo qemu-nbd -d /dev/nbd0 2>/dev/null; true"
}

$bashCmd = "$syncCmd; $nbdCleanup; KIND=$Kind ALLOCATED_RAM=$AllocatedRamMb CPU_CORES=$Cores CPU_THREADS=$Threads VNC_PORT=$VncDisplay QMP_PORT=$QmpPort SSH_FORWARD_PORT=$SshPort exec bash /tmp/run-vm-foreground.sh"

$restarts = 0
while ($true) {
  Write-Log "Launching QEMU (attempt $($restarts + 1))..."

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
