#requires -version 7
<#
.SYNOPSIS
  Automate Tailscale for the dev fleet: enrol machines, push the ACL, invite
  users, and audit who can reach what.

.DESCRIPTION
  Everything runs off ONE OAuth client, so no human has to click through the
  admin console to add a machine or a teammate.

  Credentials live in .private\credentials.env (gitignored) as
  TS_OAUTH_CLIENT_ID / TS_OAUTH_SECRET. Create the client at
  Settings > Trust credentials with scopes:
      policy_file:write, devices:core:write, auth_keys:write
  and tags tag:workstation + tag:project-server.

  ACCESS MODEL (see infra\tailscale-acl.hujson):
    tag:workstation    one personal VM per human
    tag:project-server shared per-project box (repo + Docker + database)
    group:dev          reaches every machine, over IP and Tailscale SSH

  Onboarding a new developer is therefore:
      .\tailscale-fleet.ps1 -InviteUser mihai@example.com
      .\tailscale-fleet.ps1 -AddToGroup mihai@example.com
      .\tailscale-fleet.ps1 -ApplyAcl
  and they immediately reach every project server. No per-machine work.

.EXAMPLE
  .\tailscale-fleet.ps1 -Status
  .\tailscale-fleet.ps1 -Enroll brivio-dev -Tag project-server
  .\tailscale-fleet.ps1 -Enroll mihai-dev  -Tag workstation
  .\tailscale-fleet.ps1 -ApplyAcl
  .\tailscale-fleet.ps1 -InviteUser mihai@example.com
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')][switch]$Status,

    [Parameter(ParameterSetName = 'Enroll', Mandatory)][string]$Enroll,
    [Parameter(ParameterSetName = 'Enroll')][ValidateSet('workstation', 'project-server')]
    [string]$Tag = 'workstation',

    [Parameter(ParameterSetName = 'Acl', Mandatory)][switch]$ApplyAcl,
    [Parameter(ParameterSetName = 'Acl')][string]$AclFile,

    [Parameter(ParameterSetName = 'Invite', Mandatory)][string]$InviteUser,
    [Parameter(ParameterSetName = 'Group', Mandatory)][string]$AddToGroup,

    [Parameter(ParameterSetName = 'Key', Mandatory)][switch]$NewAuthKey,
    [Parameter(ParameterSetName = 'Key')][ValidateSet('workstation', 'project-server')]
    [string]$KeyTag = 'workstation'
)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1')

$script:Api = 'https://api.tailscale.com/api/v2'
$script:Tailnet = '-'   # "-" means "the tailnet this OAuth client belongs to"

function Get-TsToken {
    if ($script:TsToken) { return $script:TsToken }
    $id = $env:TS_OAUTH_CLIENT_ID
    $secret = $env:TS_OAUTH_SECRET
    if (-not $id -or -not $secret) {
        throw 'TS_OAUTH_CLIENT_ID / TS_OAUTH_SECRET missing. Add them to .private\credentials.env (see the header of this script).'
    }
    $r = Invoke-RestMethod -Method Post -Uri 'https://api.tailscale.com/api/v2/oauth/token' `
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
    if ($null -eq $Body) {
        Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
    }
    elseif ($Body -is [string]) {
        Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $Body -ContentType $ContentType
    }
    else {
        Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers `
            -Body ($Body | ConvertTo-Json -Depth 20) -ContentType 'application/json'
    }
}

function Show-Status {
    $devices = (Invoke-Ts "/tailnet/$script:Tailnet/devices").devices
    Write-Host ''
    Write-Host '  MASINI IN TAILNET' -ForegroundColor Cyan
    '  {0,-16} {1,-16} {2,-22} {3}' -f 'nume', 'ip', 'taguri', 'ultima activitate'
    Write-Host ('  ' + ('-' * 76))
    foreach ($d in ($devices | Sort-Object name)) {
        $tags = if ($d.tags) { ($d.tags -replace 'tag:', '') -join ',' } else { '(fara tag)' }
        $seen = if ($d.lastSeen) { ([datetime]$d.lastSeen).ToLocalTime().ToString('MM-dd HH:mm') } else { '-' }
        '  {0,-16} {1,-16} {2,-22} {3}' -f ($d.name -split '\.')[0], $d.addresses[0], $tags, $seen
    }

    $acl = Invoke-Ts "/tailnet/$script:Tailnet/acl"
    Write-Host ''
    Write-Host '  GRUPURI' -ForegroundColor Cyan
    if ($acl.groups) {
        $acl.groups.PSObject.Properties | ForEach-Object {
            '    {0,-18} {1}' -f $_.Name, ($_.Value -join ', ')
        }
    }
    else { Write-Host '    (niciunul)' }

    Write-Host ''
    Write-Host '  UTILIZATORI' -ForegroundColor Cyan
    # Needs the users:read scope, which this client deliberately lacks --
    # listing humans is not required to enrol machines.
    try {
        foreach ($u in (Invoke-Ts "/tailnet/$script:Tailnet/users").users) {
            '    {0,-32} {1,-10} {2}' -f $u.loginName, $u.role, $u.status
        }
    }
    catch { Write-Host '    (necesita scope users:read - vezi consola Tailscale)' -ForegroundColor DarkGray }
    Write-Host ''
}

function New-FleetAuthKey {
    param([string]$TagName)
    # Pre-authorised + reusable so the same key can enrol several machines in
    # one run; 90 days is long enough for a provisioning session and short
    # enough that a leaked key expires.
    $body = @{
        capabilities  = @{
            devices = @{
                create = @{
                    reusable      = $true
                    ephemeral     = $false
                    preauthorized = $true
                    tags          = @("tag:$TagName")
                }
            }
        }
        expirySeconds = 7776000
        # Alphanumerics, spaces and dashes only -- Tailscale rejects the rest.
        description   = "vmui fleet enrol $TagName"
    }
    (Invoke-Ts "/tailnet/$script:Tailnet/keys" -Method POST -Body $body).key
}

function Invoke-Enroll {
    param([string]$VmName, [string]$TagName)

    if (-not (Get-VM $VmName -ErrorAction SilentlyContinue)) { throw "VM inexistent: $VmName" }
    if ((Get-VM $VmName).State -ne 'Running') { throw "$VmName nu ruleaza" }

    $cred = Get-VmuiGuestCredential -Kind fleet
    $key = New-FleetAuthKey -TagName $TagName
    Write-Host "  cheie generata pentru tag:$TagName"

    $out = Invoke-Command -VMName $VmName -Credential $cred -ArgumentList $key, $VmName -ScriptBlock {
        param($authKey, $hostName)
        $ts = 'C:\Program Files\Tailscale\tailscale.exe'
        if (-not (Test-Path $ts)) { return 'tailscale neinstalat' }

        # --unattended keeps the tunnel up with nobody logged in, which is the
        # whole point of a headless project server.
        & $ts up --authkey $authKey --hostname $hostName --unattended --accept-routes 2>&1 | Out-Null

        for ($i = 0; $i -lt 24; $i++) {
            $st = & $ts status --json 2>&1 | ConvertFrom-Json
            if ($st.BackendState -eq 'Running') {
                return "OK|$($st.Self.DNSName)|$($st.Self.TailscaleIPs[0])"
            }
            Start-Sleep 5
        }
        "TIMEOUT|$((& $ts status --json | ConvertFrom-Json).BackendState)"
    }

    $p = $out -split '\|'
    if ($p[0] -eq 'OK') { "  $VmName -> $($p[2])  ($($p[1].TrimEnd('.')))" }
    else { "  $VmName -> ESEC: $out" }
}

function Invoke-ApplyAcl {
    param([string]$File)
    if (-not $File) { $File = Join-Path (Split-Path $PSScriptRoot) 'infra\tailscale-acl.hujson' }
    if (-not (Test-Path $File)) { throw "lipseste $File" }
    $hujson = [System.IO.File]::ReadAllText($File)
    # The API accepts HuJSON (comments + trailing commas) on this content type.
    Invoke-Ts "/tailnet/$script:Tailnet/acl" -Method POST -Body $hujson -ContentType 'application/hujson' | Out-Null
    "  ACL aplicat din $File"
}

switch ($PSCmdlet.ParameterSetName) {
    'Enroll' { Invoke-Enroll -VmName $Enroll -TagName $Tag }
    'Acl' { Invoke-ApplyAcl -File $AclFile }
    'Key' { Write-Host '  cheie generata (nu este afisata); foloseste -Enroll ca sa o aplici direct'; New-FleetAuthKey -TagName $KeyTag | Out-Null }
    'Invite' {
        $r = Invoke-Ts "/tailnet/$script:Tailnet/user-invites" -Method POST -Body @(@{ role = 'member' })
        "  invitatie creata pentru $InviteUser"
        "  trimite-i linkul: $($r[0].inviteUrl)"
        '  dupa ce accepta, ruleaza: -AddToGroup ' + $InviteUser
    }
    'Group' {
        $file = Join-Path (Split-Path $PSScriptRoot) 'infra\tailscale-acl.hujson'
        $txt = [System.IO.File]::ReadAllText($file)
        if ($txt -match [regex]::Escape($AddToGroup)) { "  $AddToGroup este deja in group:dev"; break }
        $txt = $txt -replace '(?m)(^\s*"group:dev":\s*\[\s*\r?\n)', "`$1`t`t`"$AddToGroup`",`r`n"
        [System.IO.File]::WriteAllText($file, $txt)
        "  $AddToGroup adaugat in group:dev"
        Invoke-ApplyAcl -File $file
    }
    default { Show-Status }
}
