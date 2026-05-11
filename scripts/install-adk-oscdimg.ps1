# Install only the Deployment Tools (oscdimg) component of the Windows ADK.
# Runs winget elevated under the hood. The /features override limits the install
# to OptionId.DeploymentTools (~50 MB) instead of the full ~3 GB ADK.
[CmdletBinding()]
param([string]$LogPath = 'e:\gh\vmui\diag-adk-install.log')

$ErrorActionPreference = 'Continue'
"=== install-adk-oscdimg $(Get-Date) ===" | Out-File -FilePath $LogPath -Encoding ascii

# 1. winget install with --override for component selection.
'--- winget install ---' | Out-File -FilePath $LogPath -Append -Encoding ascii
& winget install --id Microsoft.WindowsADK `
  --accept-source-agreements --accept-package-agreements `
  --silent --override '/features OptionId.DeploymentTools /quiet /norestart' 2>&1 |
  Tee-Object -FilePath $LogPath -Append

# 2. Probe known install paths.
'--- probing oscdimg ---' | Out-File -FilePath $LogPath -Append -Encoding ascii
$candidates = @(
  'C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe',
  'C:\Program Files\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe'
)
foreach ($c in $candidates) {
  $exists = Test-Path $c
  "$c -> $exists" | Out-File -FilePath $LogPath -Append -Encoding ascii
  if ($exists) {
    "Version: $((Get-Item $c).VersionInfo.FileVersion)" | Out-File -FilePath $LogPath -Append -Encoding ascii
  }
}
