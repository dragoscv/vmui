#requires -version 7
<#
.SYNOPSIS
  Fixed maintenance operations that need elevation, runnable from an
            Desc = 'Restart the VS Code tunnel service once uptime exceeds 24h. Hygiene only: normalised by time spent, the failure rate does NOT rise with uptime (0.42/h at 0-4h vs 0.00/h at 4-8h). Threshold-guarded, so a run on a fresh tunnel is a no-op.'
            Daily = '05:00'
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
    [ValidateSet('TunnelRefresh', 'TunnelForceRestart', 'KillRunawayRenderer', 'WatchExtensionHost', 'InstallVmSshKey', 'Status')]
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
    # ProgramData is written by the elevated task; an unelevated manual run
    # cannot append there. Logging must never fail the operation it records.
    try { Add-Content -Path $log -Value $line -ErrorAction Stop }
    catch { Add-Content -Path (Join-Path $env:USERPROFILE '.codai\maintenance.log') -Value $line -ErrorAction SilentlyContinue }
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
    # triggering a task cannot be turned into "run arbitrary code elevated".
    #
    # Owner is the CURRENT USER, not SYSTEM. That detail is the whole trick:
    # a SYSTEM-owned task inherits a descriptor only SYSTEM and Administrators
    # may execute, so `schtasks /run` from an ordinary session fails with
    # "Access is denied" -- exactly what happened on the first attempt, which
    # defeated the entire purpose. A task owned by this user can be triggered
    # by this user with no prompt (proven: VSCodeTunnel-dragos runs as vladu
    # and `schtasks /run` returns 0 unelevated), while RunLevel Highest still
    # gives it the elevated token required to stop the S4U tunnel processes.
    # No ACL surgery, nothing to repair later.
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    Write-Host "  tasks will run as $me with RunLevel Highest"

    # An earlier revision registered these as SYSTEM. Those cannot be
    # triggered from an ordinary session, so remove them before re-creating;
    # -Force would overwrite, but an explicit unregister makes the transition
    # visible and leaves nothing behind if a name ever changes.
    foreach ($old in @(Get-ScheduledTask -ErrorAction SilentlyContinue |
            Where-Object { $_.TaskName -match '^CodaiMaint-' -and $_.Principal.UserId -eq 'SYSTEM' })) {
        Unregister-ScheduledTask -TaskName $old.TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "  removed SYSTEM-owned $($old.TaskName)" -ForegroundColor DarkGray
    }

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
        ,
        @{
            Name = 'CodaiMaint-WatchExtensionHost'
            Op   = 'WatchExtensionHost'
            Desc = 'Check whether the VM''s remote extension host has permanently given up reconnecting. Detection only; it does not reload.'
            Daily = $null
        }
        ,
        @{
            Name = 'CodaiMaint-InstallVmSshKey'
            Op   = 'InstallVmSshKey'
            Desc = 'Install the VM''s public key into administrators_authorized_keys so the VM can SSH into this host, replacing the tunnel.'
            Daily = $null
        }
    )

    foreach ($t in $tasks) {
        $action = New-ScheduledTaskAction -Execute 'pwsh.exe' `
            -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -Operation {1}' -f $PSCommandPath, $t.Op)
        # S4U: runs whether or not you are logged in, and needs no stored
        # password. Highest supplies the elevated token.
        $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType S4U -RunLevel Highest
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
        if ($t.Daily) {
            $trigger = New-ScheduledTaskTrigger -Daily -At $t.Daily
            if ($t.Repeat) {
                # A once-a-day refresh cannot hold uptime under 8 h. Repeat
                # through the day; each run is threshold-guarded, so it is a
                # no-op unless the tunnel is actually old enough to degrade.
                $trigger.Repetition = (New-ScheduledTaskTrigger -Once -At $t.Daily `
                    -RepetitionInterval (New-TimeSpan -Hours 4) `
                    -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
            }
            $params.Trigger = $trigger
        }

        Register-ScheduledTask @params | Out-Null
        $when = if ($t.Daily) { "daily at $($t.Daily)" } else { 'on demand' }
        Write-Host ("  registered {0,-34} {1}" -f $t.Name, $when) -ForegroundColor Green
    }

    Write-Host ''
    Write-Host 'Trigger from any unelevated session, no UAC prompt:' -ForegroundColor Cyan
    foreach ($t in $tasks) { Write-Host "  schtasks /run /tn `"$($t.Name)`"" }

    # Verify the actual goal, not just that registration returned. The first
    # attempt registered cleanly and was still untriggerable, which is exactly
    # the failure this check catches.
    Write-Host ''
    Write-Host 'Verifying each task is triggerable by its owner...' -ForegroundColor Cyan
    foreach ($t in $tasks) {
        $info = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
        if (-not $info) { Write-Host "  MISSING $($t.Name)" -ForegroundColor Red; continue }
        $okOwner = $info.Principal.UserId -notmatch 'SYSTEM'
        $okLevel = $info.Principal.RunLevel -eq 'Highest'
        $state = if ($okOwner -and $okLevel) { 'ok' } else { 'WRONG' }
        $colour = if ($okOwner -and $okLevel) { 'Green' } else { 'Red' }
        Write-Host ("  {0,-34} {1}  owner={2} runlevel={3}" -f $t.Name, $state, $info.Principal.UserId, $info.Principal.RunLevel) -ForegroundColor $colour
    }
    Write-Host ''
    Write-Host 'Now run this from a NORMAL (unelevated) terminal to confirm:' -ForegroundColor Yellow
    Write-Host '  schtasks /run /tn "CodaiMaint-TunnelRefresh"' -ForegroundColor Yellow
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

    'WatchExtensionHost' {
        # Detection only. A reload discards unsaved editor state and kills
        # whatever is running mid-turn; these failures are 39-439 min apart
        # and irregular, so an automatic reload would interrupt real work far
        # more often than it would rescue a dead session. Pass -AutoReload to
        # watch-extension-host.ps1 manually if that trade-off ever changes.
        & (Join-Path $root 'watch-extension-host.ps1') -Once
        Write-Log "WatchExtensionHost finished, exit $LASTEXITCODE"
        exit $LASTEXITCODE
    }

    'InstallVmSshKey' {
        # The VM connects INTO this host (the host is where the workspaces and
        # the code-tunnel server live; the VM is only ever the client). That is
        # the direction that replaces the tunnel.
        #
        # Because this account is in Administrators, sshd ignores
        # ~/.ssh/authorized_keys and reads only this file, which is writable
        # solely by Administrators+SYSTEM -- hence an elevated operation.
        $keyFile = Join-Path $env:USERPROFILE '.codai\vm-ssh-key.pub'
        if (-not (Test-Path $keyFile)) {
            Write-Log "InstallVmSshKey: $keyFile not found"
            exit 1
        }
        $key = (Get-Content $keyFile -Raw).Trim()
        if (-not $key.StartsWith('ssh-')) {
            Write-Log 'InstallVmSshKey: file does not contain a public key'
            exit 1
        }

        $dir = 'C:\ProgramData\ssh'
        $auth = Join-Path $dir 'administrators_authorized_keys'
        New-Item -ItemType Directory -Force -Path $dir | Out-Null

        $existing = if (Test-Path $auth) { Get-Content $auth -Raw } else { '' }
        if ($existing -match [regex]::Escape($key)) {
            Write-Log 'InstallVmSshKey: key already present'
        }
        else {
            Add-Content -Path $auth -Value $key -Encoding ascii
            Write-Log 'InstallVmSshKey: key added'
        }

        # sshd refuses the file outright if inheritance is left on or any
        # non-admin principal can write it.
        icacls $auth /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' 2>&1 | Out-Null

        # Manual start means no SSH after a reboot, which would strand the VM.
        $svc = Get-Service sshd -ErrorAction SilentlyContinue
        if ($svc -and $svc.StartType -ne 'Automatic') {
            Set-Service sshd -StartupType Automatic
            Write-Log 'InstallVmSshKey: sshd set to Automatic'
        }
        if ($svc -and $svc.Status -ne 'Running') { Start-Service sshd }

        Write-Log "InstallVmSshKey done, keys=$((Get-Content $auth).Count)"
        exit 0
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
