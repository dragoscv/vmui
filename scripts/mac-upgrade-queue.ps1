# vmui — queued macOS upgrade runner.
#
# Waits for the in-flight update on the current branch to finish, records the
# resulting version, then switches to the Tahoe branch and starts that upgrade.
# Every stage writes to .copilot-tmp/mac-upgrade-queue.log so the run can be
# inspected after the fact.
#
# Usage:
#   pwsh -File scripts\mac-upgrade-queue.ps1
#   pwsh -File scripts\mac-upgrade-queue.ps1 -SkipWaitForCurrent

param(
  [string]$Distro = "Ubuntu-24.04",
  [string]$TahoeBranch = "mac-tahoe",
  [switch]$SkipWaitForCurrent,
  [int]$WaitMinutes = 90,
  [switch]$Detached      # internal: set when relaunched as a detached process
)

$ErrorActionPreference = "Continue"
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo ".copilot-tmp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "mac-upgrade-queue.log"

function Say([string]$m) {
  $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $m
  # Append directly (Tee-Object holds the handle open and loses buffered
  # lines if the host process is killed mid-run).
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Host $line
}

# Relaunch detached via WMI so the run survives the parent terminal being
# closed or reaped — a 2-3 hour job must not be tied to a chat terminal.
if (-not $Detached) {
  $pwshExe = (Get-Command powershell.exe).Source
  $cmdLine = '"' + $pwshExe + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden' +
    ' -File "' + $PSCommandPath + '"' +
    ' -Distro ' + $Distro +
    ' -TahoeBranch ' + $TahoeBranch +
    ' -WaitMinutes ' + $WaitMinutes +
    ' -Detached'
  if ($SkipWaitForCurrent) { $cmdLine += ' -SkipWaitForCurrent' }

  $si = ([wmiclass]"Win32_ProcessStartup").CreateInstance()
  $si.ShowWindow = 0
  $res = ([wmiclass]"Win32_Process").Create($cmdLine, $null, $si)
  if ($res.ReturnValue -ne 0) { throw "Win32_Process.Create failed ($($res.ReturnValue))" }
  Write-Host "Queue running detached as pid $($res.ProcessId). Log: $log"
  return
}

trap {
  Say "UNHANDLED ERROR: $_"
  Say ($_.ScriptStackTrace | Out-String)
  continue
}

function Wsl([string]$cmd) { & wsl.exe -d $Distro -- bash -lc $cmd }

function Wait-Guest([int]$Minutes) {
  $deadline = (Get-Date).AddMinutes($Minutes)
  $tick = 0
  while ((Get-Date) -lt $deadline) {
    $v = $null
    try {
      $v = Wsl "sshpass -p REDACTED_GUEST_PASSWORD ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=5 -p 10022 dragos@127.0.0.1 'sw_vers -productVersion' 2>/dev/null; exit 0"
    } catch {
      Say "probe error (ignored): $_"
    }
    if ($v -and $v.Trim() -match '^\d+\.') { return $v.Trim() }
    $tick++
    if ($tick % 10 -eq 0) {
      $sz = Wsl "du -h /home/dragos/OSX-KVM/*.qcow2 2>/dev/null | tr '\n' ' '; exit 0"
      Say "  ...still waiting ($($tick * 30)s). branches: $sz"
    }
    Start-Sleep -Seconds 30
  }
  return $null
}

Say "=== queue start ==="

if (-not $SkipWaitForCurrent) {
  Say "waiting for the in-flight update to finish (max $WaitMinutes min)..."
  $v = Wait-Guest -Minutes $WaitMinutes
  if ($null -eq $v) {
    Say "TIMEOUT: guest never returned. Aborting before Tahoe so nothing is lost."
    Say "Inspect with: .\scripts\mac-branch.ps1 -List"
    exit 1
  }
  Say "STAGE 1 RESULT: guest is back on macOS $v"
  $full = Wsl "sshpass -p REDACTED_GUEST_PASSWORD ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o PreferredAuthentications=password -o ConnectTimeout=8 -p 10022 dragos@127.0.0.1 'sw_vers; echo; df -h /' 2>/dev/null; exit 0"
  Say ($full | Out-String)
}

Say "switching to branch '$TahoeBranch'..."
# 2 cores / 4 threads: PROVEN required. `-smp 8,cores=4` hangs the macOS
# installer pre-boot environment (verified 2026-08-18 on the 15.7.9 update).
& (Join-Path $PSScriptRoot "mac-branch.ps1") -Use $TahoeBranch -Distro $Distro -Cores 2 -Threads 4 2>&1 |
  ForEach-Object { Say $_ }

Say "waiting for the Tahoe branch guest to boot (max 20 min)..."
$v2 = Wait-Guest -Minutes 20
if ($null -eq $v2) {
  Say "Tahoe branch did not boot. Aborting. Branch can be reset with: .\scripts\mac-branch.ps1 -Reset $TahoeBranch"
  exit 1
}
Say "Tahoe branch booted on macOS $v2 (expected 15.7.5 from the frozen base)"

Say "STAGE 2: launching the Tahoe 26.6.2 installer (5.9 GB download)..."
$out = Wsl "tr -d '\r' < /mnt/e/gh/vmui/.copilot-tmp/mac-upgrade-tahoe.sh > /tmp/mac-upgrade-tahoe.sh; bash /tmp/mac-upgrade-tahoe.sh 2>&1"
Say ($out | Out-String)

Say "waiting for the Tahoe upgrade to complete (max 120 min)..."
$v3 = Wait-Guest -Minutes 120
if ($null -eq $v3) {
  Say "TAHOE FAILED / STILL INSTALLING: no SSH after 120 min."
  Say "The 15.7.9 branch and the golden base are untouched."
  Say "Reset with: .\scripts\mac-branch.ps1 -Reset $TahoeBranch"
  exit 1
}
Say "STAGE 2 RESULT: guest reports macOS $v3"
if ($v3 -match '^26\.') { Say "TAHOE UPGRADE SUCCEEDED" } else { Say "Tahoe did NOT take; still on $v3" }
Say "=== queue done ==="
