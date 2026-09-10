#requires -version 7
<#
.SYNOPSIS
  Tailscale automation for the PERSONAL tailnet (home network, Home Assistant).

.DESCRIPTION
  Sibling of tailscale-fleet.ps1, but for a DIFFERENT tailnet. The fleet script
  drives the brivio.ro business tailnet through TS_OAUTH_*; this one drives
  the personal tailnet (vladulescu.catalin@gmail.com, taild1532d.ts.net)
  through TS_HOME_OAUTH_*. The two tailnets cannot see each other, and the
  #1 "cannot connect" cause on this machine has been mixing them up -- hence
  a separate script with a separate credential prefix, so it is impossible to
  mint a home key with a business token by accident.

  OAuth client (created 2026-09-10, description "vmui home assistant
  automation") has scopes: policy_file:write, dns:write, devices:core:write,
  auth_keys:write -- the last two restricted to tag:appliance.

.EXAMPLE
  tailscale-home.ps1                         # status
  tailscale-home.ps1 -ApplyAcl               # push infra/tailscale-home-acl.hujson
  tailscale-home.ps1 -EnableHttps            # MagicDNS + HTTPS certs (needed by Serve)
  tailscale-home.ps1 -NewAuthKey             # one-shot key for the HA Tailscale add-on
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')]
    [switch]$Status,

    [Parameter(Mandatory, ParameterSetName = 'Acl')]
    [switch]$ApplyAcl,
    [Parameter(ParameterSetName = 'Acl')]
    [string]$AclFile,

    [Parameter(Mandatory, ParameterSetName = 'Https')]
    [switch]$EnableHttps,

    [Parameter(Mandatory, ParameterSetName = 'Key')]
    [switch]$NewAuthKey,
    # Where to write the key. Defaults to a gitignored scratch path so the
    # value never lands in terminal output (session logs persist it).
    [Parameter(ParameterSetName = 'Key')]
    [string]$OutFile = 'E:\gh\vmui\.copilot-tmp\ha-authkey.txt',

    [Parameter(Mandatory, ParameterSetName = 'Remove')]
    [string]$RemoveDevice
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1')

$script:Api = 'https://api.tailscale.com/api/v2'
$script:Tailnet = '-'

function Get-TsToken {
    if ($script:TsToken) { return $script:TsToken }
    $id = $env:TS_HOME_OAUTH_CLIENT_ID
    $secret = $env:TS_HOME_OAUTH_SECRET
    if (-not $id -or -not $secret) {
        throw 'TS_HOME_OAUTH_CLIENT_ID / TS_HOME_OAUTH_SECRET missing from .private\credentials.env'
    }
    $r = Invoke-RestMethod -Method Post -Uri "$script:Api/oauth/token" `
        -Body @{ client_id = $id; client_secret = $secret } `
        -ContentType 'application/x-www-form-urlencoded'
    $script:TsToken = $r.access_token
    $script:TsToken
}

function Invoke-Ts {
    param(
        [Parameter(Mandatory)][string]$Path,
        [string]$Method = 'GET',
        $Body,
        [string]$ContentType = 'application/json'
    )
    $headers = @{ Authorization = "Bearer $(Get-TsToken)" }
    $uri = "$script:Api$Path"
    if ($null -eq $Body) { return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers }
    if ($Body -is [string]) {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $Body -ContentType $ContentType
    }
    Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers `
        -Body ($Body | ConvertTo-Json -Depth 20) -ContentType 'application/json'
}

function Assert-HomeTailnet {
    # Refuse to run against the wrong tailnet. The business tailnet has
    # tag:project-server; the home one never will.
    $acl = Invoke-Ts "/tailnet/$script:Tailnet/acl"
    $owners = @($acl.tagOwners.PSObject.Properties.Name)
    if ($owners -contains 'tag:project-server') {
        throw 'TS_HOME_OAUTH_* points at the BUSINESS tailnet (tag:project-server present). Refusing.'
    }
}

function Show-Status {
    Assert-HomeTailnet
    $devices = (Invoke-Ts "/tailnet/$script:Tailnet/devices").devices
    Write-Host ''
    Write-Host '  home tailnet' -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * 76))
    '  {0,-18} {1,-16} {2,-14} {3,-10} {4}' -f 'name', 'ip', 'tags', 'os', 'last seen'
    foreach ($d in ($devices | Sort-Object name)) {
        $tags = if ($d.tags) { ($d.tags -replace 'tag:', '') -join ',' } else { '-' }
        $seen = if ($d.lastSeen) { ([datetime]$d.lastSeen).ToLocalTime().ToString('MM-dd HH:mm') } else { '-' }
        $colour = if ($d.tags -contains 'tag:appliance') { 'Green' } else { 'Gray' }
        Write-Host ('  {0,-18} {1,-16} {2,-14} {3,-10} {4}' -f ($d.name -split '\.')[0], $d.addresses[0], $tags, $d.os, $seen) -ForegroundColor $colour
    }
    $dns = Invoke-Ts "/tailnet/$script:Tailnet/dns/preferences"
    Write-Host ''
    Write-Host ("  MagicDNS: {0}" -f $(if ($dns.magicDNS) { 'on' } else { 'OFF -- run -EnableHttps' })) `
        -ForegroundColor $(if ($dns.magicDNS) { 'Green' } else { 'Yellow' })
    Write-Host ''
}

function Invoke-ApplyAcl {
    Assert-HomeTailnet
    $file = if ($AclFile) { $AclFile } else { Join-Path $PSScriptRoot '..\infra\tailscale-home-acl.hujson' }
    $raw = Get-Content -Raw -Path $file
    # HuJSON content type keeps comments and trailing commas.
    Invoke-Ts "/tailnet/$script:Tailnet/acl" -Method POST -Body $raw -ContentType 'application/hujson' | Out-Null
    Write-Host "  applied $(Split-Path $file -Leaf)" -ForegroundColor Green
}

function Enable-Https {
    Assert-HomeTailnet
    # Tailscale Serve issues a Let's Encrypt cert for <node>.<tailnet>.ts.net
    # only when both MagicDNS and HTTPS certificates are enabled. HTTPS itself
    # is not exposed on the API; it is toggled once in the console and this
    # script can only verify MagicDNS. Doing the MagicDNS half here removes
    # one of the two clicks.
    Invoke-Ts "/tailnet/$script:Tailnet/dns/preferences" -Method POST -Body @{ magicDNS = $true } | Out-Null
    Write-Host '  MagicDNS enabled' -ForegroundColor Green
    Write-Host '  HTTPS certificates must be enabled once in the console:' -ForegroundColor Yellow
    Write-Host '    https://console.tailscale.com/admin/dns  ->  "Enable HTTPS"' -ForegroundColor Yellow
}

function New-ApplianceAuthKey {
    Assert-HomeTailnet
    # NOT reusable and short-lived: one key per appliance enrolment. The add-on
    # only needs it once; a reusable key sitting in a text file is a liability.
    $body = @{
        capabilities  = @{
            devices = @{
                create = @{
                    reusable      = $false
                    ephemeral     = $false
                    preauthorized = $true
                    tags          = @('tag:appliance')
                }
            }
        }
        expirySeconds = 3600
        description   = 'vmui home assistant enrol'
    }
    $key = (Invoke-Ts "/tailnet/$script:Tailnet/keys" -Method POST -Body $body).key
    New-Item -ItemType Directory -Force -Path (Split-Path $OutFile) | Out-Null
    Set-Content -Path $OutFile -Value $key -NoNewline -Encoding ascii
    Write-Host "  auth key written to $OutFile (valid 1h, single use, tag:appliance)" -ForegroundColor Green
    Write-Host '  Paste it into the Tailscale add-on Web UI login, or:' -ForegroundColor DarkGray
    Write-Host '    Get-Clipboard  <- after:  Get-Content <file> | Set-Clipboard' -ForegroundColor DarkGray
}

switch ($PSCmdlet.ParameterSetName) {
    'Acl' { Invoke-ApplyAcl }
    'Https' { Enable-Https }
    'Key' { New-ApplianceAuthKey }
    'Remove' {
        Assert-HomeTailnet
        $d = (Invoke-Ts "/tailnet/$script:Tailnet/devices").devices | Where-Object { ($_.name -split '\.')[0] -eq $RemoveDevice }
        if (-not $d) { Write-Host "  no such device: $RemoveDevice" -ForegroundColor Red; exit 1 }
        Invoke-Ts "/device/$($d.id)" -Method DELETE | Out-Null
        Write-Host "  removed $RemoveDevice" -ForegroundColor Green
    }
    default { Show-Status }
}
