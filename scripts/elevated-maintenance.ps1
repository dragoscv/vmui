#requires -version 7
<#
.SYNOPSIS
  Fixed maintenance operations that need elevation, runnable from an
  unelevated session without a UAC prompt.

.DESCRIPTION
  The problem: several recurring operations need administrator rights —
  restarting the tunnel service (its task runs S4U, so unelevated
  Stop-Process silently fails), killing a runaway renderer, managing the
  Hyper-V VM. Each one costs a UAC prompt, and prompts get refused or missed
  when an agent triggers them.

  The solution: register this as a scheduled task running as SYSTEM with
  RunLevel Highest. A registered task can be triggered from ANY unelevated
  session with `schtasks /run` and no prompt. That is the same mechanism the
  tunnel service itself already uses.

  DELIBERATELY NOT a generic "run this command elevated" gate. Such a task is
  a privilege-escalation backdoor: any unelevated process on the machine could
  invoke it with arbitrary arguments. Instead every operation is a named
  branch below with FIXED behaviour, registered as its own task, so triggering
  it can only do the one reviewed thing.

  Adding an operation means editing this file and registering a new task —
  which is the point.

.PARAMETER Operation
  Which fixed operation to run. See the switch below.

.NOTES
  Register with -Register (needs one elevation, once).
  Then: schtasks /run /tn "CodaiMaint-TunnelRefresh"   (no prompt, forever)
#>
[CmdletBinding()]
param(
    [ValidateSet('TunnelRefresh', 'TunnelForceRestart', 'KillRunawayRenderer', 'Status')]
    [string]$Operation = 'Status',
    [switch]$Register
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$logDir = Join-Path $env:ProgramData 'codai-maintenance'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'maintenance.log'

function Write-Log([string]$m) {
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    Add-Content -Path $log -Value $line
    Write-Host $line
}

# --------------------------------------------------------------------------
# Registration. One elevation, once. After this every operation is silent.
# --------------------------------------------------------------------------
if ($Register) {
    $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $elevated) {
        Write-Host 'Registration needs elevation. Run this once from an admin PowerShell:' -ForegroundColor Yellow
        Write-Host "  pwsh -NoProfile -File `"$PSCommandPath`" -Register" -ForegroundColor Cyan
        exit 1
    }

    # Each task is a fixed operation. No arguments come from the caller, so
    # triggering a task cannot be turned into "run arbitrary code as SYSTEM".
    $tasks = @(
        @{
            Name = 'CodaiMaint-TunnelRefresh'
            Op   = 'TunnelRefresh'
            Desc = 'Restart the VS Code tunnel service once uptime exceeds 40h. Degradation past ~45h causes hourly connection disposals that kill chat sessions.'
            Daily = '05:00'
        },
        @{
            Name = 'CodaiMaint-TunnelForceRestart'
            Op   = 'TunnelForceRestart'
            Desc = 'Restart the VS Code tunnel service immediately, regardless of uptime. On demand only.'
            Daily = $null
        },
        @{
            Name = 'CodaiMaint-KillRunawayRenderer'
            Op   = 'KillRunawayRenderer'
            Desc = 'Terminate any VS Code renderer over 4 GB working set. A renderer that reaches ~7 GB stops responding and takes its window down.'
            Daily = $null
        }
    )

    foreach ($t in $tasks) {
        $action = New-ScheduledTaskAction -Execute 'pwsh.exe' `
            -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Operation {1}' -f $PSCommandPath, $t.Op)
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
            -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew

        $params = @{
            TaskName    = $t.Name
            Action      = $action
            Principal   = $principal
            Settings    = $settings
            Description = $t.Desc
            Force       = $true
        }
        if ($t.Daily) { $params.Trigger = New-ScheduledTaskTrigger -Daily -At $t.Daily }

        Register-ScheduledTask @params | Out-Null
        $when = if ($t.Daily) { "daily at $($t.Daily)" } else { 'on demand' }
        Write-Host ("  registered {0,-34} {1}" -f $t.Name, $when) -ForegroundColor Green
    }

    Write-Host ''
    Write-Host 'Trigger from any unelevated session, no UAC prompt:' -ForegroundColor Cyan
    foreach ($t in $tasks) { Write-Host "  schtasks /run /tn `"$($t.Name)`"" }
    exit 0
}

# --------------------------------------------------------------------------
# Operations
# --------------------------------------------------------------------------
switch ($Operation) {

    'TunnelRefresh' {
        # Threshold-guarded: a no-op on a healthy service, so the daily
        # trigger costs nothing.
        & (Join-Path $root 'restart-tunnel.ps1')
        Write-Log "TunnelRefresh finished, exit $LASTEXITCODE"
        exit $LASTEXITCODE
    }

    'TunnelForceRestart' {
        & (Join-Path $root 'restart-tunnel.ps1') -Force
        Write-Log "TunnelForceRestart finished, exit $LASTEXITCODE"
        exit $LASTEXITCODE
    }

    'KillRunawayRenderer' {
        # Only renderers, only over the threshold, and never one holding a
        # network connection -- that would be the one serving the tunnel.
        $limitMB = 4096
        $killed = 0
        foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='Code - Insiders.exe'" -EA SilentlyContinue)) {
            if ($proc.CommandLine -notmatch '--type=renderer') { continue }
            $mb = [int]($proc.WorkingSetSize / 1MB)
            if ($mb -lt $limitMB) { continue }

            $conns = @(Get-NetTCPConnection -State Established -EA SilentlyContinue |
                Where-Object { $_.OwningProcess -eq $proc.ProcessId }).Count
            if ($conns -gt 0) {
                Write-Log "SKIP renderer pid $($proc.ProcessId) at ${mb}MB - holds $conns connection(s)"
                continue
            }

            Stop-Process -Id $proc.ProcessId -Force -EA SilentlyContinue
            Write-Log "killed renderer pid $($proc.ProcessId) at ${mb}MB"
            $killed++
        }
        if (-not $killed) { Write-Log 'KillRunawayRenderer: nothing over threshold' }
        exit 0
    }

    'Status' {
        $pids = @(Get-Process 'code-tunnel' -EA SilentlyContinue).Id
        $up = -1
        if ($pids.Count) {
            $oldest = $null
            foreach ($p in $pids) {
                $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -EA SilentlyContinue
                if ($ci -and $ci.CreationDate -and (-not $oldest -or $ci.CreationDate -lt $oldest)) {
                    $oldest = $ci.CreationDate
                }
            }
            if ($oldest) { $up = [math]::Round(((Get-Date) - $oldest).TotalHours, 1) }
        }
        $relay = 0
        if ($pids.Count) {
            $relay = @(Get-NetTCPConnection -State Established -EA SilentlyContinue |
                Where-Object { $_.OwningProcess -in $pids -and $_.RemotePort -eq 443 }).Count
        }
        Write-Host "  tunnel uptime : $up h"
        Write-Host "  relay links   : $relay"
        Write-Host "  running as    : $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
        exit 0
    }
}
