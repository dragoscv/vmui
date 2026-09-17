<#
.SYNOPSIS
  Create a full Home Assistant backup over the WebSocket API and download it.
  Works on HAOS and on HA container (backup manager, HA >= 2025.1).
.EXAMPLE
  pwsh -File scripts\ha-backup-pull.ps1 -Out .copilot-tmp\pi\ha-backup.tar
#>
param(
  [string] $Out = "$PSScriptRoot\..\.copilot-tmp\pi\ha-full-$(Get-Date -Format yyyyMMdd-HHmm).tar",
  [string] $Password
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1')
$base = $env:HA_URL.TrimEnd('/')

function Send-Ws([hashtable]$msg, [int]$timeoutSec = 900) {
  $ws = [Net.WebSockets.ClientWebSocket]::new()
  $cts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($timeoutSec))
  $uri = [Uri](($base -replace '^http', 'ws') + '/api/websocket')
  $ws.ConnectAsync($uri, $cts.Token).GetAwaiter().GetResult()
  $recv = {
    $buf = [byte[]]::new(1MB); $sb = [Text.StringBuilder]::new()
    do {
      $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $cts.Token).GetAwaiter().GetResult()
      [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
    } while (-not $r.EndOfMessage)
    $sb.ToString() | ConvertFrom-Json
  }
  $send = {
    param($o)
    $b = [Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Depth 10 -Compress))
    $ws.SendAsync([ArraySegment[byte]]::new($b), [Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
  }
  try {
    $hello = & $recv
    if ($hello.type -ne 'auth_required') { throw "greeting $($hello.type)" }
    & $send @{ type = 'auth'; access_token = $env:HA_TOKEN }
    if ((& $recv).type -ne 'auth_ok') { throw 'ws auth failed' }
    $msg.id = 1
    & $send $msg
    do { $reply = & $recv } while ($reply.id -ne 1)
    if (-not $reply.success) { throw "ws $($msg.type): $($reply.error.message)" }
    return $reply.result
  } finally { $ws.Dispose() }
}

Write-Host "backup/generate on $base ..."
$agents = (Send-Ws @{ type = 'backup/agents/info' }).agents
$local = ($agents | Where-Object { $_.agent_id -match '\.local$' } | Select-Object -First 1).agent_id
if (-not $local) { throw "no local backup agent; got $($agents.agent_id -join ',')" }
Write-Host "agent: $local"
$gen = @{ type = 'backup/generate'; agent_ids = @($local); include_homeassistant = $true; include_database = $true; include_all_addons = $false; include_folders = @('share', 'ssl', 'media') }
if ($Password) { $gen.password = $Password }
$res = Send-Ws $gen
$id = $res.backup_job_id
Write-Host "job $id started; waiting for completion"
do {
  Start-Sleep 10
  $info = Send-Ws @{ type = 'backup/info' }
  $state = $info.state
  $last = $info.last_completed_automatic_backup
  Write-Host "  state=$state backups=$($info.backups.Count)"
} while ($state -eq 'create_backup')
$latest = $info.backups | Sort-Object date -Descending | Select-Object -First 1
if (-not $latest) { throw 'no backup listed' }
Write-Host "latest: $($latest.backup_id) $($latest.name) $($latest.date) with_db=$($latest.with_automatic_settings)"
$dir = Split-Path $Out -Parent
New-Item -ItemType Directory -Force $dir | Out-Null
$agent = ($latest.agents.PSObject.Properties.Name | Select-Object -First 1)
$url = "$base/api/backup/download/$($latest.backup_id)?agent_id=$agent"
Invoke-WebRequest -Uri $url -Headers @{ Authorization = "Bearer $env:HA_TOKEN" } -OutFile $Out
$size = [math]::Round((Get-Item $Out).Length / 1MB, 1)
Write-Host "saved $Out ($size MB)"
