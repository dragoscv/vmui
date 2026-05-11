# Stop the Hyper-V Win11 VM.
#
# Default: graceful shutdown via integration services. If the guest is
# still in OOBE / not booted, integration services aren't running yet —
# in that case use -Force to power it off.
[CmdletBinding()]
param(
  [string]$VmName = 'vmui-win',
  [switch]$Force,
  [switch]$Save
)
$ErrorActionPreference = 'Stop'

$vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if (-not $vm) { Write-Host "VM '$VmName' does not exist."; exit 0 }
if ($vm.State -eq 'Off') { Write-Host "VM '$VmName' already off."; exit 0 }

if ($Save) {
  Write-Host "Saving VM state..."
  Save-VM -Name $VmName
} elseif ($Force) {
  Write-Host "Forcing power-off..."
  Stop-VM -Name $VmName -TurnOff -Force
} else {
  Write-Host "Requesting graceful shutdown (use -Force to power-off, -Save to save state)..."
  Stop-VM -Name $VmName -Force:$false -ErrorAction SilentlyContinue
  if ($LASTEXITCODE -ne 0 -or (Get-VM -Name $VmName).State -ne 'Off') {
    Start-Sleep -Seconds 2
  }
}

Get-VM -Name $VmName | Format-List Name,State,Uptime
