#requires -version 7
<#
.SYNOPSIS
  Run the production vmui (next start on 127.0.0.1:3737) as a logon task.

.DESCRIPTION
  `pnpm dev` is for editing. For the phone (https://mui.dragoscatalin.ro via
  scripts/publish-vmui.ps1) vmui must be up whenever the PC is, without a
  terminal open. This registers a hidden, auto-restarting task owned by the
  current user. Rebuild + restart after a code change:

    pnpm build; scripts\vmui-service.ps1 -Restart

.EXAMPLE
  vmui-service.ps1 -Install
  vmui-service.ps1 -Status
  vmui-service.ps1 -Restart
  vmui-service.ps1 -Uninstall
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')][switch]$Status,
    [Parameter(Mandatory, ParameterSetName = 'Install')][switch]$Install,
    [Parameter(Mandatory, ParameterSetName = 'Restart')][switch]$Restart,
    [Parameter(Mandatory, ParameterSetName = 'Uninstall')][switch]$Uninstall,
    [int]$Port = 3737
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$TaskName = 'vmui-service'
$Node = (Get-Command node).Source
$Launcher = Join-Path $PSScriptRoot 'vmui-service-run.mjs'
$LogDir = Join-Path $Root '.copilot-tmp\service-logs'

function Write-Ok($m) { Write-Host "  $m" -ForegroundColor Green }

function Get-Listener { Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 }

function Stop-Service-Tree {
    $l = Get-Listener
    if (-not $l) { return }
    # next start spawns workers; kill the tree from the listener's root.
    $pid = $l.OwningProcess
    $chain = @($pid)
    for ($i = 0; $i -lt 4; $i++) {
        $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue).ParentProcessId
        if (-not $parent) { break }
        $pp = Get-CimInstance Win32_Process -Filter "ProcessId=$parent" -ErrorAction SilentlyContinue
        if ($pp.CommandLine -notmatch 'next|pnpm|node') { break }
        $chain += $parent; $pid = $parent
    }
    foreach ($id in ($chain | Sort-Object -Descending)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    Start-Sleep 1
}

function Install-Task {
    New-Item -ItemType Directory -Force $LogDir | Out-Null
    $action = New-ScheduledTaskAction -Execute $Node -Argument "`"$Launcher`"" -WorkingDirectory $Root
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $logon.Delay = 'PT10S'
    # The launcher spawns next detached and exits, so the scheduler cannot
    # "restart on failure"; instead it re-runs every 5 min and the launcher
    # exits at once when :3737 already answers.
    $watch = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5)
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -StartWhenAvailable -MultipleInstances IgnoreNew -Hidden
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon, $watch) -Settings $settings -Description 'vmui production server on 127.0.0.1:3737 (scripts/vmui-service.ps1)' | Out-Null
    Write-Ok "task $TaskName registered"
}

function Start-Service-Task {
    if (Get-Listener) { Write-Ok "port $Port already served"; return }
    Start-ScheduledTask -TaskName $TaskName
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline -and -not (Get-Listener)) { Start-Sleep 1 }
    if (Get-Listener) { Write-Ok "listening on :$Port" } else { throw "vmui did not start; see $LogDir\vmui.log" }
}

function Show-Status {
    $t = (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue).State
    $l = Get-Listener
    Write-Host "  task     $($t ?? 'absent')"
    $up = if ($l) { $p = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue; "pid $($l.OwningProcess), up $([int]((Get-Date) - $p.StartTime).TotalMinutes) min" } else { 'NOT listening' }
    Write-Host "  :$Port    $up"
    if ($l) { $h = curl.exe -s -o NUL -w '%{http_code}' "http://127.0.0.1:$Port/api/health" --max-time 5; Write-Host "  health   $h" }
    if (Test-Path "$LogDir\vmui.log") { Write-Host '  log tail:'; Get-Content "$LogDir\vmui.log" -Tail 3 | ForEach-Object { "    $_" } }
}

switch ($PSCmdlet.ParameterSetName) {
    'Install' { Install-Task; Start-Service-Task; Show-Status }
    'Restart' { Stop-Service-Tree; Start-Service-Task; Show-Status }
    'Uninstall' { Stop-Service-Tree; Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue; Write-Ok 'removed' }
    default { Show-Status }
}
