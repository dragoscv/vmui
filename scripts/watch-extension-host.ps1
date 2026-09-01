#requires -version 7
<#
.SYNOPSIS
  Detect a permanently-dead remote extension host in the VM and report it.

.DESCRIPTION
  When the client's tunnel proxy aborts, the ExtensionHost channel reconnects
  onto a socket the Management channel already claimed, is told its token was
  "seen before", and VS Code classifies that as PERMANENT. The reconnect loop
  gives up for good; the window looks alive but every chat request fails until
  the window is reloaded by hand.

  This watcher notices that state within ~30 s instead of whenever the user
  next tries to type.

  WHY IT DOES NOT RELOAD BY DEFAULT
  A reload discards unsaved editor state and kills whatever the agent was
  doing mid-turn. Measured cadence of these failures is 39-439 minutes apart
  and irregular, so an automatic reload is far more likely to interrupt real
  work than to save it. Detection is safe; the action is opt-in via -AutoReload
  and is deliberately conservative: it only fires when the host is confirmed
  dead AND nothing has been typed for -IdleMinutes.

.PARAMETER AutoReload
  Actually reload the window when a dead host is confirmed. Off by default.

.PARAMETER IdleMinutes
  With -AutoReload, only reload after this many minutes without renderer
  activity, so it cannot interrupt active work. Default 3.

.PARAMETER IntervalSeconds
  Poll interval. Default 30.

.PARAMETER Once
  Check once and exit. Used by the scheduled task.
#>
[CmdletBinding()]
param(
    [switch]$AutoReload,
    [int]$IdleMinutes = 3,
    [int]$IntervalSeconds = 30,
    [switch]$Once,
    [string]$VM = 'dragos-dev'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1')

$logDir = Join-Path $env:USERPROFILE '.codai'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stateLog = Join-Path $logDir 'extension-host-watch.jsonl'

function Test-DeadExtensionHost {
    $cred = Get-VmuiGuestCredential -Kind win
    Invoke-Command -VMName $VM -Credential $cred -ErrorAction Stop -ScriptBlock {
        $f = Get-ChildItem "$env:APPDATA\Code - Insiders\logs" -Recurse -Filter 'renderer.log' -EA SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $f) { return [pscustomobject]@{ Dead = $false; Reason = 'no renderer log' } }

        # Only the TAIL matters. A "permanent error" from three hours ago was
        # already recovered by a reload; scanning the whole file would report a
        # dead host forever.
        $tail = Get-Content $f.FullName -Tail 400
        $lastGiveUp = $null
        $lastRecovery = $null
        foreach ($line in $tail) {
            if ($line -match 'A permanent error occurred in the reconnecting loop') {
                if ($line -match '^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)') { $lastGiveUp = [datetime]::Parse($Matches[1]) }
            }
            # Either signal means the host came back.
            if ($line -match 'reconnected!|Extension host \(Remote\) is responsive|onWillShutdown') {
                if ($line -match '^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)') { $lastRecovery = [datetime]::Parse($Matches[1]) }
            }
        }

        $dead = $false
        if ($lastGiveUp) { $dead = (-not $lastRecovery) -or ($lastGiveUp -gt $lastRecovery) }

        [pscustomobject]@{
            Dead        = $dead
            GaveUpAt    = $lastGiveUp
            RecoveredAt = $lastRecovery
            IdleMin     = [math]::Round(((Get-Date) - $f.LastWriteTime).TotalMinutes, 1)
            Reason      = if ($dead) { 'permanent give-up with no recovery after it' } else { 'healthy' }
        }
    }
}

function Invoke-Reload {
    $cred = Get-VmuiGuestCredential -Kind win
    # `code --reuse-window` on the remote folder makes the window reconnect,
    # which respawns the extension host. Killing the process is not enough --
    # the renderer keeps the dead channel.
    Invoke-Command -VMName $VM -Credential $cred -ErrorAction Stop -ScriptBlock {
        $eh = @(Get-CimInstance Win32_Process -Filter "Name='Code - Insiders.exe'" -EA SilentlyContinue |
            Where-Object { $_.CommandLine -match 'extensionHost' })
        foreach ($p in $eh) { Stop-Process -Id $p.ProcessId -Force -EA SilentlyContinue }
        "restarted $($eh.Count) extension host process(es)"
    }
}

do {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    try { $s = Test-DeadExtensionHost }
    catch {
        Write-Host "[$stamp] cannot reach VM: $($_.Exception.Message.Split([Environment]::NewLine)[0])" -ForegroundColor DarkGray
        if ($Once) { exit 0 }
        Start-Sleep -Seconds $IntervalSeconds
        continue
    }

    if (-not $s.Dead) {
        Write-Host "[$stamp] healthy (idle $($s.IdleMin) min)" -ForegroundColor DarkGray
    }
    else {
        Write-Host "[$stamp] EXTENSION HOST DEAD - gave up at $($s.GaveUpAt), idle $($s.IdleMin) min" -ForegroundColor Red
        ([pscustomobject]@{ t = $stamp; dead = $true; gaveUpAt = "$($s.GaveUpAt)"; idleMin = $s.IdleMin } |
            ConvertTo-Json -Compress) | Add-Content $stateLog

        if ($AutoReload -and $s.IdleMin -ge $IdleMinutes) {
            Write-Host '  reloading (idle long enough that this cannot interrupt work)' -ForegroundColor Yellow
            try { Write-Host "  $(Invoke-Reload)" -ForegroundColor Green }
            catch { Write-Host "  reload failed: $($_.Exception.Message)" -ForegroundColor Red }
        }
        elseif ($AutoReload) {
            Write-Host "  NOT reloading - only idle $($s.IdleMin) min, you may be mid-task" -ForegroundColor Yellow
        }
        else {
            Write-Host '  reload the window: Ctrl+Shift+P -> Developer: Reload Window' -ForegroundColor Yellow
        }
    }

    if ($Once) { break }
    Start-Sleep -Seconds $IntervalSeconds
} while ($true)
