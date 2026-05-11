# Start the Hyper-V Win11 VM and (optionally) open a console window.
[CmdletBinding()]
param(
  [string]$VmName = 'vmui-win',
  [switch]$NoConsole
)
$ErrorActionPreference = 'Stop'

$vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if (-not $vm) {
  Write-Error "VM '$VmName' does not exist. Run scripts/setup-win-hyperv.ps1 first."
  exit 2
}

if ($vm.State -ne 'Running') {
  Write-Host "Starting VM '$VmName' (current state: $($vm.State))..."
  Start-VM -Name $VmName
} else {
  Write-Host "VM '$VmName' already running."
}

Get-VM -Name $VmName | Format-List Name,State,Uptime,CPUUsage,MemoryAssigned

if (-not $NoConsole) {
  $vmc = Join-Path $env:WINDIR 'System32\vmconnect.exe'
  if (Test-Path $vmc) {
    Write-Host "Launching console: $vmc localhost $VmName"
    Start-Process -FilePath $vmc -ArgumentList @('localhost', $VmName)
  } else {
    Write-Warning "vmconnect.exe not found; open Hyper-V Manager manually."
  }
}
