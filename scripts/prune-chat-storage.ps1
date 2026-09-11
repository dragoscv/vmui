#Requires -Version 5.1
<#
.SYNOPSIS
  Archive stale VS Code chat *editing* state so windows stop freezing on open.

.DESCRIPTION
  VS Code stores, per workspace, two things under User\workspaceStorage\<id>\:
    chatSessions\*.jsonl      the conversations. NEVER touched by this script.
    chatEditingSessions\<id>\ pending Keep/Undo diff state for edits already
                              applied to the working tree.
  On window open, every entry in every restored editing session becomes a
  working copy (2 text models each). Measured on dragos-dev 2026-09-12: 513
  working copies, 6418 unacknowledged messages on the ext-host socket, the
  socket timed out every 20 s and the extension host exited 6 times in 13 min
  ("Initializing apps/web/tsconfig.json" freeze).

  This moves editing-session dirs older than -MaxAgeDays, or holding more than
  -MaxEntries pending files, to %LOCALAPPDATA%\vmui-archive\chatEditingSessions\
  keeping the workspace id and dir name, so a plain Move-Item restores them.
  Nothing is deleted.

.PARAMETER Register
  Register a logon scheduled task (current user, 90 s delay) running this
  script with the same thresholds, so it runs before VS Code opens.

.EXAMPLE
  pwsh -File scripts\prune-chat-storage.ps1 -WhatIf
  pwsh -File scripts\prune-chat-storage.ps1
  pwsh -File scripts\prune-chat-storage.ps1 -Register
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [int]$MaxAgeDays = 2,
  [int]$MaxEntries = 100,
  [string[]]$Edition = @("Code - Insiders", "Code"),
  [switch]$Register,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if ($Register) {
  $pwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
  if (-not $pwshExe) { $pwshExe = (Get-Command powershell).Source }
  $action = New-ScheduledTaskAction -Execute $pwshExe -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -MaxAgeDays {1} -MaxEntries {2}" -f $PSCommandPath, $MaxAgeDays, $MaxEntries)
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $trigger.Delay = "PT90S"
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -StartWhenAvailable
  Register-ScheduledTask -TaskName "VmuiPruneChatStorage" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host "Registered task VmuiPruneChatStorage (logon, +90s): $pwshExe -File $PSCommandPath"
  return
}

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $Edition -contains $_.ProcessName })
if ($running.Count -gt 0 -and -not $Force) {
  Write-Host ("VS Code is running ({0} processes) - skipping. Moving state under a live window would corrupt it. Use -Force only after closing it." -f $running.Count)
  exit 3
}

$archiveRoot = Join-Path $env:LOCALAPPDATA "vmui-archive\chatEditingSessions"
$cutoff = (Get-Date).AddDays(-$MaxAgeDays)
$moved = 0; $movedBytes = 0L; $kept = 0

foreach ($ed in $Edition) {
  $wsRoot = Join-Path $env:APPDATA "$ed\User\workspaceStorage"
  if (-not (Test-Path $wsRoot)) { continue }
  foreach ($ws in Get-ChildItem $wsRoot -Directory) {
    $ce = Join-Path $ws.FullName "chatEditingSessions"
    if (-not (Test-Path $ce)) { continue }
    foreach ($sess in Get-ChildItem $ce -Directory) {
      $stateFile = Join-Path $sess.FullName "state.json"
      $entries = 0
      if (Test-Path $stateFile) {
        try {
          $st = Get-Content $stateFile -Raw | ConvertFrom-Json
          if ($st.recentSnapshot) { $entries = @($st.recentSnapshot.entries).Count }
        } catch { $entries = -1 }
      }
      $old = $sess.LastWriteTime -lt $cutoff
      $big = $entries -gt $MaxEntries
      if (-not ($old -or $big)) { $kept++; continue }

      $size = (Get-ChildItem $sess.FullName -Recurse -File | Measure-Object Length -Sum).Sum
      $dest = Join-Path $archiveRoot ("{0}\{1}\{2}" -f $ed, $ws.Name, $sess.Name)
      $reason = @(); if ($old) { $reason += "age" }; if ($big) { $reason += "entries=$entries" }
      if ($PSCmdlet.ShouldProcess($sess.FullName, "archive to $dest [$($reason -join ',')]")) {
        New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Move-Item $sess.FullName $dest
        $moved++; $movedBytes += $size
      }
    }
  }
}

Write-Host ("archived {0} editing sessions ({1} MB) to {2}; kept {3}" -f $moved, [int]($movedBytes / 1MB), $archiveRoot, $kept)
