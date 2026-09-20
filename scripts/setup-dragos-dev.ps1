# vmui — provision "dragos-dev": a minimal Windows 11 Hyper-V VM whose only
# job is to host a VS Code remote tunnel, reachable over Tailscale via RDP.
#
# This is a thin wrapper around scripts/setup-win-hyperv.ps1 that pins the
# naming/sizing for this specific machine and persists the generated password
# to .private/credentials.env (gitignored).
#
# Edition note: this deliberately uses the RETAIL consumer 25H2 ISO and the
# "Windows 11 Pro" image. The earlier build used an Enterprise EVALUATION ISO,
# which Microsoft blocks from ever being converted to a licensed edition
# (`DISM /Get-TargetEditions` reports no valid targets). Pro can be activated
# normally with a real key: `slmgr /ipk <key>; slmgr /ato`.
#
# After this completes, run:
#     powershell -File scripts\provision-dragos-dev.ps1
# which installs Tailscale + the VS Code CLI and debloats the guest over
# PowerShell Direct (works before the guest has any network).
[CmdletBinding()]
param(
  [string]$VmName         = 'dragos-dev',
  [string]$Username       = 'dragos',
  [string]$Password       = '',
  [string]$WindowsIsoPath = 'D:\Kits\Win11_25H2_English_x64_v2.iso',
  [string]$ImageName      = 'Windows 11 Pro',
  # Public Microsoft KMS client setup key for Win11 Pro. Only used to skip the
  # "enter your product key" page during setup; the install remains
  # unactivated until a real key is applied.
  [string]$ProductKey     = 'W269N-WFGWX-YVC9B-4J6C9-T83GX',
  [string]$VmDir          = 'E:\Hyper-V\dragos-dev',
  [int]$DiskGb            = 128,
  [int]$RamMb             = 32768,
  [int]$Cpus              = 16,
  [string]$SwitchName     = 'Default Switch',
  [switch]$ForceRecreate,
  [switch]$SkipIsoBuild
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib\win-credentials.ps1"

# ---------------------------------------------------------------------------
# Resolve + persist the guest password.
#
# Resolve-VmuiCredential would return an empty password for the default
# "dragos" user when .private/credentials.env has no WIN_GUEST_PASS, so
# generate one explicitly and write it back for later scripts to reuse.
# ---------------------------------------------------------------------------
$privateDir = Join-Path (Split-Path -Parent $PSScriptRoot) '.private'
$credFile   = Join-Path $privateDir 'credentials.env'

if (-not $Password) { $Password = $env:DRAGOS_DEV_PASS }
if (-not $Password) { $Password = New-VmuiPassword }

New-Item -ItemType Directory -Force -Path $privateDir | Out-Null
$existingLines = if (Test-Path -LiteralPath $credFile) {
  @(Get-Content -LiteralPath $credFile | Where-Object { $_ -notmatch '^\s*DRAGOS_DEV_(USER|PASS)\s*=' })
} else { @() }
$newLines = $existingLines + @("DRAGOS_DEV_USER=$Username", "DRAGOS_DEV_PASS=$Password")
Set-Content -LiteralPath $credFile -Value $newLines -Encoding utf8
Write-Host "Credentials persisted to $credFile"

# ---------------------------------------------------------------------------
# Delegate to the generic Hyper-V provisioner.
# ---------------------------------------------------------------------------
$setupArgs = @{
  VmName         = $VmName
  Username       = $Username
  Password       = $Password
  ComputerName   = $VmName
  WindowsIsoPath = $WindowsIsoPath
  ImageName      = $ImageName
  ProductKey     = $ProductKey
  VmDir          = $VmDir
  DiskGb         = $DiskGb
  RamMb          = $RamMb
  Cpus           = $Cpus
  SwitchName     = $SwitchName
}
if ($ForceRecreate) { $setupArgs.ForceRecreate = $true }
if ($SkipIsoBuild)  { $setupArgs.SkipIsoBuild  = $true }

& "$PSScriptRoot\setup-win-hyperv.ps1" @setupArgs

# ---------------------------------------------------------------------------
# Boot it. Windows Setup runs fully unattended from here (~10-20 min).
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[boot] Starting '$VmName'..."
Start-VM -Name $VmName -ErrorAction SilentlyContinue | Out-Null
Get-VM -Name $VmName | Format-List Name, State, MemoryStartup, ProcessorCount

Write-Host ""
Write-Host "Unattended Windows Setup is running. Watch it with:"
Write-Host "    vmconnect.exe localhost $VmName"
Write-Host ""
Write-Host "When the desktop appears, finish provisioning with:"
Write-Host "    powershell -File scripts\provision-dragos-dev.ps1"
