<#
.SYNOPSIS
  Publish Home Assistant on the Pi at https://home.dragoscatalin.ro.

  DNS A -> 192.168.100.232 (LAN; the Nest Hub must reach it for casting), cert
  via lego DNS-01 on Vercel, Caddy on the Pi, HA external_url/internal_url set.
  The Pi advertises 192.168.100.0/24 on the tailnet, so the same name works
  away from home once the route is approved in the Tailscale admin console.

.EXAMPLE
  scripts\pi-publish-ha.ps1
#>
[CmdletBinding()]
param(
    [string]$Domain = 'home.dragoscatalin.ro',
    [string]$LanIp = '192.168.100.232',
    [string]$Pi = 'homepi',
    [string]$Email = 'vladulescu.catalin@gmail.com'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
. (Join-Path $Root 'scripts\lib\guest-credentials.ps1') | Out-Null
foreach ($k in 'VERCEL_API_TOKEN', 'HA_TOKEN') { if (-not (Get-Item "env:$k" -ErrorAction SilentlyContinue)) { throw "$k missing in .private/credentials.env" } }

$Zone = ($Domain -split '\.', 2)[1]; $Sub = ($Domain -split '\.', 2)[0]
function Invoke-Vercel([string]$Method, [string]$Path, $Body) {
    $sep = if ($Path.Contains('?')) { '&' } else { '?' }
    $team = if ($env:VERCEL_TEAM_ID) { "${sep}teamId=$env:VERCEL_TEAM_ID" } else { '' }
    $h = @{ Authorization = "Bearer $env:VERCEL_API_TOKEN" }
    if ($Body) { Invoke-RestMethod -Method $Method "https://api.vercel.com$Path$team" -Headers $h -ContentType 'application/json' -Body ($Body | ConvertTo-Json) }
    else { Invoke-RestMethod -Method $Method "https://api.vercel.com$Path$team" -Headers $h }
}
Write-Host "dns: $Domain A $LanIp"
$recs = (Invoke-Vercel GET "/v4/domains/$Zone/records?limit=100").records
$mine = $recs | Where-Object { $_.name -eq $Sub -and $_.type -in 'A', 'AAAA', 'CNAME' }
if (-not ($mine.Count -eq 1 -and $mine[0].value -eq $LanIp)) {
    foreach ($r in $mine) { Invoke-Vercel DELETE "/v2/domains/$Zone/records/$($r.id)" | Out-Null }
    Invoke-Vercel POST "/v2/domains/$Zone/records" @{ name = $Sub; type = 'A'; value = $LanIp; ttl = 60 } | Out-Null
    Write-Host "  record replaced"
}
else { Write-Host "  already correct" }

Write-Host "pi: tailscale + lego + caddy"
$sh = (Get-Content (Join-Path $Root 'pi\publish-ha.sh') -Raw) -replace "`r`n", "`n"
[IO.File]::WriteAllText((Join-Path $Root '.copilot-tmp\pi\publish-ha.sh'), $sh, [Text.UTF8Encoding]::new($false))
scp -q -o BatchMode=yes (Join-Path $Root '.copilot-tmp\pi\publish-ha.sh') "${Pi}:/tmp/publish-ha.sh"
# secrets travel as env on the ssh command line of the Pi only (not echoed)
$envLine = "VERCEL_API_TOKEN='$env:VERCEL_API_TOKEN' VERCEL_TEAM_ID='$env:VERCEL_TEAM_ID' LE_EMAIL='$Email' DOMAIN='$Domain' LAN_IP='$LanIp'"
ssh -o BatchMode=yes $Pi "$envLine bash /tmp/publish-ha.sh; rm -f /tmp/publish-ha.sh"
if ($LASTEXITCODE -ne 0) { throw "publish-ha.sh failed ($LASTEXITCODE)" }

Write-Host "ha: external_url / internal_url"
$h = @{ Authorization = "Bearer $env:HA_TOKEN"; 'content-type' = 'application/json' }
$cfg = Invoke-RestMethod "http://$LanIp/api/config" -Headers $h
$needRestart = ssh -o BatchMode=yes $Pi "grep -c '^http:' /srv/homepi/ha/configuration.yaml"
if ($cfg.external_url -ne "https://$Domain") {
  # core config lives in .storage/core.config; the supported write path is the
  # websocket `config/core/update` (pi/ha-set-urls.cjs, run from the vmui dir for `ws`).
  scp -q -o BatchMode=yes (Join-Path $Root 'pi\ha-set-urls.cjs') "${Pi}:/srv/homepi/vmui/.ha-set-urls.cjs"
  # token as base64 in the remote command: a piped token picks up CRLF and HA answers auth_invalid
  $b = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($env:HA_TOKEN.Trim()))
  $remote = 'cd /srv/homepi/vmui && T=$(echo ' + $b + ' | base64 -d) timeout 20 node .ha-set-urls.cjs https://' + $Domain + ' http://' + $LanIp + '; rm -f .ha-set-urls.cjs'
  ssh -o BatchMode=yes $Pi $remote 2>&1 | ForEach-Object { "  $_" }
}
if ([int]$needRestart -ge 1) { ssh -o BatchMode=yes $Pi 'docker restart homeassistant >/dev/null'; Write-Host "  HA restarted for http: trusted_proxies"; Start-Sleep 60 }

Write-Host "verify"
$ip = (Resolve-DnsName $Domain -Type A -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
Write-Host "  dns -> $ip"
Write-Host "  https -> $((curl.exe -s -m 10 -o NUL -w '%{http_code}' "https://$Domain/"))"
$cfg = Invoke-RestMethod "https://$Domain/api/config" -Headers $h
Write-Host "  external_url=$($cfg.external_url) internal_url=$($cfg.internal_url)"
