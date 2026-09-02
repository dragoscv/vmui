#requires -version 7
<#
.SYNOPSIS
  Create and manage restricted SSH users that can reach only named folders.

.DESCRIPTION
  Gives a user an SSH key and access to a chosen set of folders under a root
  (E:\gh by default), while everything else in that root stays unreadable.

  HOW THE ISOLATION WORKS
  `E:\gh` grants `Authenticated Users: Modify`, which every new account
  inherits, so an allow-list alone would do nothing. NTFS resolves an explicit
  DENY ahead of any ALLOW, including inherited ones, so the account gets:

    1. DENY  on E:\gh itself, applied to subfolders and files only
       ("ThisFolder" is NOT included, or the user could not traverse into the
       folders you did grant)
    2. ALLOW on each permitted folder, which overrides the inherited deny for
       that subtree

  The global permissions on E:\gh are left untouched.

  WHAT THIS IS AND IS NOT
  This is a real filesystem boundary: the account cannot read or write the
  other projects, from SSH or from anywhere else.

  It is NOT a sandbox. A Windows shell can still read C:\Windows, list
  processes, and see environment variables. `ChrootDirectory` does not help --
  Microsoft's docs state it applies to SFTP sessions only and "a remote session
  into cmd.exe doesn't honor ChrootDirectory". For untrusted code, use a VM.

  The account is deliberately NON-admin: sshd reads
  administrators_authorized_keys for admin accounts, which would bypass the
  per-user key file entirely.

.PARAMETER Name
  Account name, e.g. dev-brivio.

.PARAMETER Allow
  Folders the account may read and write. Absolute, or relative to -Root.

.PARAMETER ReadOnly
  Folders the account may read but not modify.

.PARAMETER Root
  The tree to lock down. Default E:\gh.

.PARAMETER Remove
  Delete the account and its permission entries.

.PARAMETER Status
  Show what a given account can currently reach.

.EXAMPLE
  ssh-user.ps1 -Name dev-brivio -Allow brivio
  ssh-user.ps1 -Name dev-brivio -Allow brivio,vmui -ReadOnly workspace
  ssh-user.ps1 -Name dev-brivio -Status
  ssh-user.ps1 -Name dev-brivio -Remove
#>
[CmdletBinding(DefaultParameterSetName = 'Create')]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidatePattern('^[a-zA-Z][a-zA-Z0-9\-_]{2,19}$')]
    [string]$Name,

    [Parameter(ParameterSetName = 'Create')]
    [string[]]$Allow = @(),

    [Parameter(ParameterSetName = 'Create')]
    [string[]]$ReadOnly = @(),

    [string]$Root = 'E:\gh',

    [Parameter(ParameterSetName = 'Remove')]
    [switch]$Remove,

    [Parameter(ParameterSetName = 'Status')]
    [switch]$Status
)

$ErrorActionPreference = 'Stop'

function Test-Elevated {
    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-Target([string]$p) {
    if ([IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $Root $p }
}

# ---------------------------------------------------------------- status ----
if ($Status) {
    $u = Get-LocalUser -Name $Name -ErrorAction SilentlyContinue
    if (-not $u) { Write-Host "  account '$Name' does not exist" -ForegroundColor Red; exit 1 }

    Write-Host "  account : $Name  (enabled=$($u.Enabled))"
    $isAdmin = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "\\$Name$" }).Count -gt 0
    Write-Host "  admin   : $isAdmin$(if ($isAdmin) { '   <- BREAKS ISOLATION, sshd would use administrators_authorized_keys' })" `
        -ForegroundColor $(if ($isAdmin) { 'Red' } else { 'Gray' })

    $keyFile = "C:\Users\$Name\.ssh\authorized_keys"
    Write-Host "  key     : $(if (Test-Path $keyFile) { "installed ($((Get-Content $keyFile).Count))" } else { 'MISSING' })"

    Write-Host ''
    Write-Host '  folders it can reach:' -ForegroundColor Cyan
    $any = $false
    foreach ($d in Get-ChildItem $Root -Directory -ErrorAction SilentlyContinue) {
        $acl = Get-Acl $d.FullName -ErrorAction SilentlyContinue
        $ace = @($acl.Access | Where-Object {
                $_.IdentityReference -match "\\$Name$" -and $_.AccessControlType -eq 'Allow'
            })
        if ($ace) {
            $any = $true
            Write-Host ("    {0,-28} {1}" -f $d.Name, ($ace[0].FileSystemRights -join ','))
        }
    }
    if (-not $any) { Write-Host '    (none)' -ForegroundColor DarkGray }
    exit 0
}

if (-not (Test-Elevated)) {
    Write-Host '  needs an elevated shell (creates accounts and edits ACLs).' -ForegroundColor Red
    Write-Host "  pwsh -NoProfile -File `"$PSCommandPath`" -Name $Name ..." -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------- remove ----
if ($Remove) {
    Write-Host "  removing ACL entries for $Name..." -ForegroundColor Cyan
    foreach ($p in @($Root) + @(Get-ChildItem $Root -Directory -EA SilentlyContinue | ForEach-Object FullName)) {
        $acl = Get-Acl $p -ErrorAction SilentlyContinue
        if (-not $acl) { continue }
        $hit = @($acl.Access | Where-Object { $_.IdentityReference -match "\\$Name$" })
        if (-not $hit) { continue }
        foreach ($a in $hit) { $acl.RemoveAccessRule($a) | Out-Null }
        Set-Acl -Path $p -AclObject $acl
        Write-Host "    cleaned $p"
    }
    if (Get-LocalUser -Name $Name -ErrorAction SilentlyContinue) {
        Remove-LocalUser -Name $Name
        Write-Host "  account $Name deleted" -ForegroundColor Green
    }
    exit 0
}

# ---------------------------------------------------------------- create ----
if (-not $Allow -and -not $ReadOnly) {
    Write-Host '  give at least one -Allow or -ReadOnly folder.' -ForegroundColor Red
    exit 1
}

foreach ($f in @($Allow) + @($ReadOnly)) {
    $t = Resolve-Target $f
    if (-not (Test-Path $t)) { Write-Host "  no such folder: $t" -ForegroundColor Red; exit 1 }
}

# Account. A random password is set because Windows requires one; it is never
# used or displayed -- login is by key only.
if (-not (Get-LocalUser -Name $Name -ErrorAction SilentlyContinue)) {
    $bytes = [byte[]]::new(24)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $pw = ConvertTo-SecureString ([Convert]::ToBase64String($bytes) + '!Aa1') -AsPlainText -Force
    New-LocalUser -Name $Name -Password $pw -FullName "SSH: $Name" `
        -Description "Restricted SSH account (managed by ssh-user.ps1)" `
        -PasswordNeverExpires -UserMayNotChangePassword | Out-Null
    Write-Host "  created account $Name" -ForegroundColor Green
}
else { Write-Host "  account $Name already exists, updating" }

# Must NOT be an administrator, or sshd reads administrators_authorized_keys
# and the per-user key file is ignored.
$inAdmins = @(Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "\\$Name$" }).Count -gt 0
if ($inAdmins) {
    Remove-LocalGroupMember -Group 'Administrators' -Member $Name
    Write-Host '  removed from Administrators (would have bypassed isolation)' -ForegroundColor Yellow
}

# The profile must exist before the key can be placed in it. Creating it
# properly needs a logon, so build the folder directly and grant the user.
$home_ = "C:\Users\$Name"
$sshDir = Join-Path $home_ '.ssh'
New-Item -ItemType Directory -Force -Path $sshDir | Out-Null

# Key.
$keyPriv = Join-Path $sshDir "id_ed25519_$Name"
$keyOut = Join-Path $env:USERPROFILE ".codai\ssh-keys\$Name"
New-Item -ItemType Directory -Force -Path (Split-Path $keyOut) | Out-Null

if (-not (Test-Path "$keyOut")) {
    & ssh-keygen.exe -t ed25519 -f $keyOut -N '""' -C "$Name@$env:COMPUTERNAME" 2>&1 | Out-Null
    Write-Host "  generated key: $keyOut" -ForegroundColor Green
}
else { Write-Host "  reusing key: $keyOut" }

$pub = (Get-Content "$keyOut.pub" -Raw).Trim()
$authFile = Join-Path $sshDir 'authorized_keys'
$existing = if (Test-Path $authFile) { Get-Content $authFile -Raw } else { '' }
if ($existing -notmatch [regex]::Escape($pub)) {
    Add-Content -Path $authFile -Value $pub -Encoding ascii
}

# sshd refuses a key file that anyone else can write.
icacls $home_ /grant "${Name}:(OI)(CI)F" /T /Q 2>&1 | Out-Null
icacls $authFile /inheritance:r /grant "${Name}:F" /grant 'SYSTEM:F' /grant 'Administrators:F' 2>&1 | Out-Null
Write-Host '  key installed and locked down'

# ------------------------------------------------------------------ ACLs ----
Write-Host ''
Write-Host "  applying isolation on $Root ..." -ForegroundColor Cyan

$acl = Get-Acl $Root
foreach ($a in @($acl.Access | Where-Object { $_.IdentityReference -match "\\$Name$" })) {
    $acl.RemoveAccessRule($a) | Out-Null
}

# ObjectInherit+ContainerInherit with InheritOnly: applies to everything BELOW
# the root but not to the root itself, so the user can still traverse into the
# folders that are granted below. Denying the root outright would block those
# too.
$deny = New-Object Security.AccessControl.FileSystemAccessRule(
    $Name, 'FullControl',
    'ObjectInherit,ContainerInherit', 'InheritOnly', 'Deny')
$acl.AddAccessRule($deny)

# Traverse-only on the root: list it, walk through it, change nothing.
$traverse = New-Object Security.AccessControl.FileSystemAccessRule(
    $Name, 'ReadAndExecute', 'None', 'None', 'Allow')
$acl.AddAccessRule($traverse)
Set-Acl -Path $Root -AclObject $acl
Write-Host "    deny inherited on everything under $Root"

foreach ($f in $Allow) {
    $t = Resolve-Target $f
    $a = Get-Acl $t
    foreach ($old in @($a.Access | Where-Object { $_.IdentityReference -match "\\$Name$" })) {
        $a.RemoveAccessRule($old) | Out-Null
    }
    $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
                $Name, 'Modify', 'ObjectInherit,ContainerInherit', 'None', 'Allow')))
    Set-Acl -Path $t -AclObject $a
    Write-Host "    read+write  $t" -ForegroundColor Green
}

foreach ($f in $ReadOnly) {
    $t = Resolve-Target $f
    $a = Get-Acl $t
    foreach ($old in @($a.Access | Where-Object { $_.IdentityReference -match "\\$Name$" })) {
        $a.RemoveAccessRule($old) | Out-Null
    }
    $a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
                $Name, 'ReadAndExecute', 'ObjectInherit,ContainerInherit', 'None', 'Allow')))
    Set-Acl -Path $t -AclObject $a
    Write-Host "    read-only   $t" -ForegroundColor Green
}

# ----------------------------------------------------------------- sshd -----
$sshdCfg = 'C:\ProgramData\ssh\sshd_config'
$cfgText = Get-Content $sshdCfg -Raw
if ($cfgText -notmatch '(?m)^\s*AllowGroups|^\s*AllowUsers') {
    Write-Host ''
    Write-Host '  note: sshd_config has no AllowUsers/AllowGroups, so every local' -ForegroundColor Yellow
    Write-Host '  account may log in. Restrict it if that matters.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Give the other machine this private key:' -ForegroundColor Cyan
Write-Host "  $keyOut"
Write-Host ''
Write-Host 'Their ~/.ssh/config entry:' -ForegroundColor Cyan
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress
@"
  Host $Name
      HostName $ip
      User $Name
      IdentityFile ~/.ssh/id_ed25519_$Name
      ServerAliveInterval 30
      AddressFamily inet
"@ | Write-Host
Write-Host "Verify:  ssh-user.ps1 -Name $Name -Status" -ForegroundColor Yellow
