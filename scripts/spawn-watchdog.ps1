# vmui — fully detach the watchdog from the caller's process tree.
#
# Called by vmui's startInstance() with the watchdog parameters.
#
# Why we use WMI Win32_Process.Create instead of plain Start-Process:
# Node spawns this script inside a Job Object (Next.js dev server). Anything
# we launch as a normal child — even via Start-Process — INHERITS that job,
# so when the Server Action returns and the job is sealed, the watchdog dies
# too. Win32_Process.Create() always breaks away from the calling process's
# job object (it's a separate WMI service call), so the new powershell.exe
# is truly independent and survives indefinitely.
#
# This thin launcher exits immediately. No console window is ever shown.
#
# Backward compat: -Kind defaults to "mac" so the legacy mac-only callers
# (and the old VS Code tasks) keep working unchanged.

param(
  [string]$Distro,
  [ValidateSet("mac","win","ubuntu")]
  [string]$Kind = "mac",
  [int]$AllocatedRamMb,
  [int]$Cores,
  [int]$Threads,
  [int]$VncDisplay,
  [int]$QmpPort,
  [int]$SshPort,
  [string]$MacDisk = ""   # mac only: overlay/system disk filename inside VMDIR
)

$ErrorActionPreference = "Stop"
# Single generic watchdog for all guest kinds.
$watchdog = Join-Path $PSScriptRoot "watchdog-vm.ps1"
$pwshExe = (Get-Command powershell.exe).Source

# Preflight: kill any prior watchdog instance FOR THIS KIND and orphaned
# QEMU/launcher processes inside WSL so we never stack instances racing on
# the QMP/VNC ports. Other-kind watchdogs are intentionally left alone.
$existing = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object {
    $_.CommandLine -match 'watchdog-(vm|mac)\.ps1' -and
    $_.CommandLine -match ("-Kind\s+" + [regex]::Escape($Kind) + "\b")
  })
# Legacy: the old mac watchdog didn't pass -Kind, so include it for kind=mac.
if ($Kind -eq "mac") {
  $existing += @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match 'watchdog-mac\.ps1' })
}
foreach ($p in $existing) {
  try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
}

# Best-effort cleanup of any orphan QEMU and stale pidfile/logs in WSL. We
# match by the QMP TCP port so we only kill OUR qemu (other kinds untouched).
$pidPattern = "vmui-${Kind}"
$cleanupCmd = "pkill -9 -f 'qemu-system-x86_64.*qmp tcp:127.0.0.1:$QmpPort' 2>/dev/null; rm -f /tmp/${pidPattern}.pid /tmp/${pidPattern}.log /tmp/${pidPattern}.qemu.log; exit 0"
& wsl.exe -d $Distro -- bash -lc $cleanupCmd 2>$null | Out-Null

# Build the command line. Each arg is integer/short identifier; safe to inline.
$cmdLine = '"' + $pwshExe + '"' +
  ' -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden' +
  ' -File "' + $watchdog + '"' +
  ' -Distro ' + $Distro +
  ' -Kind ' + $Kind +
  ' -AllocatedRamMb ' + $AllocatedRamMb +
  ' -Cores ' + $Cores +
  ' -Threads ' + $Threads +
  ' -VncDisplay ' + $VncDisplay +
  ' -QmpPort ' + $QmpPort +
  ' -SshPort ' + $SshPort

if ($Kind -eq "mac" -and $MacDisk -ne "") {
  $cmdLine += ' -MacDisk "' + $MacDisk + '"'
}

$si = ([wmiclass]"Win32_ProcessStartup").CreateInstance()
$si.ShowWindow = 0  # SW_HIDE

$cls = [wmiclass]"Win32_Process"
$result = $cls.Create($cmdLine, $null, $si)

if ($result.ReturnValue -ne 0) {
  throw "Win32_Process.Create failed (ReturnValue=$($result.ReturnValue))"
}
Write-Output $result.ProcessId
