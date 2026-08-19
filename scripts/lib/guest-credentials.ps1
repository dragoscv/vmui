# vmui — load local guest credentials for the PowerShell scripts.
#
# Credentials used to live as plaintext literals in ~24 tracked files. This
# repo is PUBLIC, so they now live in .private/credentials.env, which is
# gitignored. Dot-source this file instead of hardcoding a password:
#
#   . "$PSScriptRoot\lib\guest-credentials.ps1"
#   $cred = Get-VmuiGuestCredential -Kind win
#
# Precedence: an existing environment variable always wins, so a one-off
# `$env:WIN_GUEST_PASS = '...'` overrides the file without editing it.

$script:VmuiCredCandidates = @(
  $env:VMUI_CREDENTIALS_FILE,
  (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.private\credentials.env'),
  'E:\gh\vmui\.private\credentials.env',
  (Join-Path $HOME '.vmui\credentials.env')
) | Where-Object { $_ }

foreach ($candidate in $script:VmuiCredCandidates) {
  if (-not (Test-Path -LiteralPath $candidate)) { continue }
  foreach ($line in Get-Content -LiteralPath $candidate) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name, $value = $line -split '=', 2
    $name = $name.Trim()
    if (-not $name) { continue }
    # Do not clobber a value already present in the environment.
    if ([Environment]::GetEnvironmentVariable($name)) { continue }
    Set-Item -Path "env:$name" -Value $value.Trim()
  }
  break
}

if (-not $env:MAC_GUEST_USER)    { $env:MAC_GUEST_USER = 'dragos' }
if (-not $env:WIN_GUEST_USER)    { $env:WIN_GUEST_USER = 'dragos' }
if (-not $env:UBUNTU_GUEST_USER) { $env:UBUNTU_GUEST_USER = 'dragos' }

function Get-VmuiGuestCredential {
  <#
  .SYNOPSIS
    Returns a PSCredential for a local VM guest.
  .PARAMETER Kind
    mac | win | ubuntu
  .NOTES
    Throws if no password is configured, rather than silently trying a
    hardcoded default — a wrong password can lock out an account.
  #>
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][ValidateSet('mac', 'win', 'ubuntu')][string]$Kind
  )

  $userVar = switch ($Kind) {
    'mac'    { 'MAC_GUEST_USER' }
    'win'    { 'WIN_GUEST_USER' }
    'ubuntu' { 'UBUNTU_GUEST_USER' }
  }
  $passVar = switch ($Kind) {
    'mac'    { 'MAC_GUEST_PASS' }
    'win'    { 'WIN_GUEST_PASS' }
    'ubuntu' { 'UBUNTU_GUEST_PASS' }
  }

  $user = [Environment]::GetEnvironmentVariable($userVar)
  $pass = [Environment]::GetEnvironmentVariable($passVar)

  if (-not $pass) {
    throw "Guest credentials not found for '$Kind'. Create .private\credentials.env (see .private\README.md) or set `$env:$passVar before running."
  }

  New-Object System.Management.Automation.PSCredential(
    $user,
    (ConvertTo-SecureString $pass -AsPlainText -Force)
  )
}
