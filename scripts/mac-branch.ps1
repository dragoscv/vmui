# vmui — switch the macOS guest between qcow2 overlay branches.
#
# The golden system image (~/OSX-KVM/mac_hdd_ng.img) is frozen read-only and
# every branch is a thin qcow2 overlay on top of it, so an OS upgrade can be
# tested on a throwaway branch and reverted in one second.
#
# Usage:
#   pwsh -File scripts\mac-branch.ps1 -List
#   pwsh -File scripts\mac-branch.ps1 -Use   mac-15.7.9
#   pwsh -File scripts\mac-branch.ps1 -Reset  mac-tahoe      # discard branch
#   pwsh -File scripts\mac-branch.ps1 -Stop
#
# NOTE: the parameter is -Use, not -Switch: $Switch collides with the
# PowerShell automatic variable used by the `switch` statement.

[CmdletBinding(DefaultParameterSetName = "List")]
param(
  [Parameter(ParameterSetName = "List")]
  [switch]$List,

  [Parameter(ParameterSetName = "Use", Mandatory = $true)]
  [string]$Use,

  [Parameter(ParameterSetName = "Reset", Mandatory = $true)]
  [string]$Reset,

  [Parameter(ParameterSetName = "Stop")]
  [switch]$Stop,

  [string]$Distro = "Ubuntu-24.04",

  # Guest sizing. Defaults match the historical config. macOS installer
  # pre-boot environments HANG on wide SMP topologies: `-smp 8,cores=4`
  # wedges the updater (no disk growth, frozen frame, every vCPU pegged)
  # while `-smp 4,cores=2` completes it. Verified 2026-08-18 on 15.7.9.
  # Always pass -Cores 2 -Threads 4 when running an OS install/upgrade.
  [int]$RamMb = 16384,
  [int]$Cores = 4,
  [int]$Threads = 8
)

$ErrorActionPreference = "Stop"
$vmDir = "/home/dragos/OSX-KVM"
$base = "mac_hdd_ng.img"

function Invoke-Wsl([string]$Command) {
  & wsl.exe -d $Distro -- bash -lc $Command
}

function Stop-MacVm {
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" |
    Where-Object { $_.CommandLine -match 'watchdog-(vm|mac)\.ps1' -and $_.CommandLine -match '-Kind\s+mac\b' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  # Graceful guest shutdown first, so APFS is left clean.
  # Delegated to a real script file: nesting this many quote levels through
  # PowerShell -> wsl -> bash -> ssh -> sudo is unreliable.
  $shutOut = Invoke-Wsl "tr -d '\r' < /mnt/e/gh/vmui/scripts/mac-guest-shutdown.sh > /tmp/mac-guest-shutdown.sh; bash /tmp/mac-guest-shutdown.sh 2>&1"
  if ($shutOut) { Write-Host "  guest shutdown said: $($shutOut -join ' | ')" }

  # macOS can take a few minutes to shut down after an OS update (it may be
  # finalising a snapshot), so allow 5 minutes before forcing.
  for ($i = 0; $i -lt 60; $i++) {
    $running = Invoke-Wsl "pgrep -f 'qemu-system-x86_64 -name vmui-mac' >/dev/null && echo yes || echo no"
    if ($running -match 'no') { Write-Host "VM stopped cleanly after $($i * 5)s."; return }
    Start-Sleep -Seconds 5
  }
  Write-Warning "Guest did not shut down in 300s; forcing (APFS will journal-replay on next boot)."
  Invoke-Wsl "pkill -9 -f 'qemu-system-x86_64 -name vmui-mac'; exit 0" | Out-Null
}

switch ($PSCmdlet.ParameterSetName) {
  "List" {
    Invoke-Wsl "cd $vmDir && ls -la $base mac_hdd_ng.golden-*.img mac-*.qcow2 2>/dev/null; echo; echo '--- disk usage ---'; du -h mac-*.qcow2 2>/dev/null; echo; df -h $vmDir | tail -1"
    Write-Host "`n--- currently booted ---"
    Invoke-Wsl "pgrep -af 'qemu-system-x86_64 -name vmui-mac' | grep -o 'file=mac[^,]*' | head -1; exit 0"
  }

  "Stop" { Stop-MacVm }

  "Reset" {
    $exists = Invoke-Wsl "test -f $vmDir/$Reset.qcow2 && echo yes || echo no"
    if ($exists -notmatch 'yes') { throw "Branch '$Reset' does not exist." }
    Stop-MacVm
    Invoke-Wsl "cd $vmDir && rm -f $Reset.qcow2 && qemu-img create -f qcow2 -F qcow2 -b $base $Reset.qcow2"
    Write-Host "Branch '$Reset' reset to the golden base."
  }

  "Use" {
    $exists = Invoke-Wsl "test -f $vmDir/$Use.qcow2 && echo yes || echo no"
    if ($exists -notmatch 'yes') {
      Write-Host "Branch '$Use' does not exist; creating it from the golden base."
      Invoke-Wsl "cd $vmDir && qemu-img create -f qcow2 -F qcow2 -b $base $Use.qcow2"
    }
    Stop-MacVm
    $spawn = Join-Path $PSScriptRoot "spawn-watchdog.ps1"
    $wdPid = & $spawn -Distro $Distro -Kind mac -AllocatedRamMb $RamMb -Cores $Cores -Threads $Threads `
      -VncDisplay 0 -QmpPort 4444 -SshPort 10022 -MacDisk "$Use.qcow2"
    Write-Host "Booting branch '$Use' (watchdog pid $wdPid) with ${Cores}c/${Threads}t, ${RamMb}MB. VNC :5900, SSH :10022."
  }
}
