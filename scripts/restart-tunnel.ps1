#requires -version 7
<#
.SYNOPSIS
  Restart the VS Code tunnel service before its uptime degrades the connection.

.DESCRIPTION
  Measured 2026-09-01. After ~45 h of uptime the tunnel service began disposing
  its connection to the running server roughly every 60 minutes, around the
  clock — 29 disposals and 89 NoAttachedServerError in a single day's log, with
  no user activity for most of them.

  Each disposal forces the client to reconnect, and a reconnect can hit the
  upstream token-reuse bug (microsoft/vscode#195632): the ExtensionHost channel
  reuses a token the Management channel already consumed, VS Code classifies
  that as PERMANENT, the reconnect loop gives up, and every chat session in that
  window dies.

  The failure rate tracks uptime, not usage:

    28 Aug   8 failures / 18.7 h = 0.43/h
    29 Aug  10 failures / 17.6 h = 0.57/h
    30 Aug   8 failures / 23.9 h = 0.33/h
    31 Aug  16 failures / 10.6 h = 1.51/h   <- service had been up ~45 h

  Restarting resets it. This script is the scheduled prophylactic.

.PARAMETER Force
  Restart regardless of uptime. Without it, the service is left alone below
  -MaxUptimeHours, so the weekly task is a no-op on a freshly started service.

.PARAMETER MaxUptimeHours
  Restart only past this uptime. Default 8.

  The original 40 h came from ONE observation (a service up ~45 h). With eight
  failures now recorded against uptime — 0, 10.4, 12, 14.1, 14.2, 16.4, 16.5
  and 22.1 h — seven were above 10 h, so a 40 h guard essentially never fired
  when it mattered. 8 h restarts before the band where failures cluster.

  The 0 h outlier matters too: restarting reduces the rate but does not
  eliminate the fault, whose origin is the client-side proxy abort.

.NOTES
  The tunnel task runs S4U, so its processes cannot be stopped from an
  unelevated session: Stop-Process reports success and the process survives,
  and Win32_Process GetOwner returns access-denied (code 2). Run elevated.
#>
[CmdletBinding()]
param(
    [switch]$Force,
    [int]$MaxUptimeHours = 8,
    [string]$TaskName = 'VSCodeTunnel-dragos'
)

$ErrorActionPreference = 'Stop'

function Get-TunnelUptimeHours {
    $pids = @(Get-Process 'code-tunnel' -ErrorAction SilentlyContinue).Id
    if (-not $pids.Count) { return -1 }
    $oldest = $null
    foreach ($p in $pids) {
        $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
        if ($ci -and $ci.CreationDate) {
            if (-not $oldest -or $ci.CreationDate -lt $oldest) { $oldest = $ci.CreationDate }
        }
    }
    if (-not $oldest) { return -1 }
    return [math]::Round(((Get-Date) - $oldest).TotalHours, 1)
}

$up = Get-TunnelUptimeHours
Write-Host "tunnel uptime: $up h (threshold $MaxUptimeHours h)"

if (-not $Force -and $up -ge 0 -and $up -lt $MaxUptimeHours) {
    Write-Host 'below threshold - nothing to do' -ForegroundColor DarkGray
    exit 0
}

$elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $elevated) {
    # Failing loudly matters: unelevated Stop-Process SUCCEEDS silently against
    # an S4U process while the process keeps running, which reads as "restarted"
    # when nothing happened.
    Write-Host 'must run elevated - the tunnel task runs S4U' -ForegroundColor Red
    exit 1
}

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Get-Process 'code-tunnel' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 6

$pids = @(Get-Process 'code-tunnel' -ErrorAction SilentlyContinue).Id
if (-not $pids.Count) {
    Write-Host 'FAILED: no tunnel process after restart' -ForegroundColor Red
    exit 1
}

# Registered with the relay is the only signal that the tunnel is reachable;
# a running process proves nothing.
$relay = 0
foreach ($attempt in 1..6) {
    $relay = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -in $pids -and $_.RemotePort -eq 443 }).Count
    if ($relay -gt 0) { break }
    Start-Sleep -Seconds 5
}

Write-Host "restarted: pid $($pids -join ', '), relay connections $relay" -ForegroundColor Green
if ($relay -eq 0) {
    Write-Host 'WARNING: process is up but not registered with the relay yet' -ForegroundColor Yellow
    exit 1
}
exit 0
