<#
.SYNOPSIS
  Unfreeze a VM's VS Code Insiders window that is stuck on "Initializing..."
  against this host's Remote-SSH server, WITHOUT closing that window or
  losing its chat sessions.

.DESCRIPTION
  Symptom: the VM renderer reconnects every 20 s (`socket timeout ...
  unacknowledgedMessage ... reconnected!`) and the host's remoteagent.log
  logs `The client has reconnected.` at the same cadence. The remote
  extension host is alive but no longer drains its socket.

  Fix: kill ONLY that extension host. It runs in sshd's logon session, so
  killing it needs an elevated token; this script triggers the pre-registered
  `CodaiMaint-RestartRemoteExtHost` task (owner = you, RunLevel Highest, so
  `schtasks /run` needs no UAC), then proves the outcome: ext host relaunched
  and the reconnect loop stopped. Chats, editors and terminals in the VM
  window are untouched — only extensions restart (~10 s).

  -Force kills even when the discriminator says the ext host looks healthy.

  Registration (once, admin):  pwsh -File scripts\elevated-maintenance.ps1 -Register
#>
[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$task = 'CodaiMaint-RestartRemoteExtHost'
$logRoot = Join-Path $env:USERPROFILE '.vscode-server-insiders\data\logs'
$maintLog = Join-Path $env:ProgramData 'codai-maintenance\maintenance.log'

function Say([string]$m, [string]$c = 'Gray') { Write-Host $m -ForegroundColor $c }

$dir = Get-ChildItem $logRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName 'remoteagent.log') } |
    Sort-Object { (Get-Item (Join-Path $_.FullName 'remoteagent.log')).LastWriteTime } -Descending |
    Select-Object -First 1
if (-not $dir) { Say 'No Remote-SSH server log found under .vscode-server-insiders - nothing is connected.' Yellow; exit 1 }
$agentLog = Join-Path $dir.FullName 'remoteagent.log'

function Reconnects([int]$Minutes) {
    $cut = (Get-Date).AddMinutes(-$Minutes)
    @(Get-Content $agentLog -Tail 400 | Where-Object { $_ -match 'The client has reconnected' } | ForEach-Object {
        if ($_ -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') { [datetime]$Matches[1] } } | Where-Object { $_ -gt $cut }).Count
}
function ExtHostPid {
    $l = Get-Content $agentLog -Tail 400 | Where-Object { $_ -match '<(\d+)> Launched Extension Host Process' } | Select-Object -Last 1
    if ($l -and $l -match '<(\d+)> Launched') { [int]$Matches[1] } else { 0 }
}

$before = Reconnects 2
$pidBefore = ExtHostPid
Say ("server log: {0}" -f $agentLog)
Say ("ext host pid {0}, {1} client reconnects in the last 2 min" -f $pidBefore, $before)
if ($before -lt 3 -and -not $Force) {
    Say 'Session looks healthy (fewer than 3 reconnects/2 min). Re-run with -Force to kill anyway.' Green
    exit 0
}

if (-not (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue)) {
    Say "Task $task is not registered. Once, from an ADMIN pwsh:" Yellow
    Say "  pwsh -NoProfile -File `"$PSScriptRoot\elevated-maintenance.ps1`" -Register" Cyan
    exit 1
}

$logLines = if (Test-Path $maintLog) { (Get-Content $maintLog | Measure-Object -Line).Lines } else { 0 }
# Tasks take no caller arguments by design (a generic elevated runner would be
# a privilege-escalation hole), so -Force is a marker file the op consumes.
$marker = Join-Path $env:USERPROFILE '.codai\force-restart-exthost'
New-Item -ItemType Directory -Force (Split-Path $marker) | Out-Null
if ($Force) { Set-Content $marker '1' } elseif (Test-Path $marker) { Remove-Item $marker -Force }

Say "triggering $task ..."
schtasks /run /tn $task | Out-Null

$deadline = (Get-Date).AddSeconds(45)
$result = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    $info = Get-ScheduledTaskInfo -TaskName $task
    if ($info.LastRunTime -gt (Get-Date).AddMinutes(-1) -and (Get-ScheduledTask -TaskName $task).State -ne 'Running') { $result = $info.LastTaskResult; break }
}
if ($null -eq $result) { Say 'task did not finish within 45 s' Yellow; exit 1 }
$new = if (Test-Path $maintLog) { Get-Content $maintLog | Select-Object -Skip $logLines } else { @() }
$new | ForEach-Object { Say "  $_" }
if ($result -ne 0) { Say "task exit $result" Red; exit 1 }

Say 'waiting for the new extension host and a quiet connection (30 s)...'
Start-Sleep -Seconds 30
$pidAfter = ExtHostPid
$after = @(Get-Content $agentLog -Tail 60 | Where-Object { $_ -match 'The client has reconnected' } | ForEach-Object {
    if ($_ -match '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})') { [datetime]$Matches[1] } } | Where-Object { $_ -gt (Get-Date).AddSeconds(-25) }).Count
$alive = [bool](Get-Process -Id $pidAfter -ErrorAction SilentlyContinue)
Say ("ext host: {0} -> {1} (alive={2}); reconnects in last 25 s: {3}" -f $pidBefore, $pidAfter, $alive, $after) $(if ($pidAfter -ne $pidBefore -and $alive -and $after -eq 0) { 'Green' } else { 'Yellow' })
if ($pidAfter -eq $pidBefore) { Say 'ext host pid unchanged - kill did not take effect' Red; exit 1 }
if (-not $alive) { Say 'new ext host not (yet) running - the VM window should restart it; check the VM' Yellow; exit 1 }
if ($after -gt 0) { Say 'still reconnecting - the cause is not the ext host (check host VSS / disk stall / VM network)' Yellow; exit 1 }
Say 'VERIFIED: extension host restarted, connection quiet. The VM window keeps its chats.' Green
exit 0
