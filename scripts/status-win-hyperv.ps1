# Show Hyper-V VM status: state, RAM/CPU, IP from integration services.
[CmdletBinding()]
param([string]$VmName = 'vmui-win')

$ErrorActionPreference = 'Stop'

$vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if (-not $vm) { Write-Host "VM '$VmName' does not exist."; exit 0 }

Write-Host '=== VM ==='
$vm | Format-List Name,State,Uptime,CPUUsage,MemoryAssigned,Generation,Version

Write-Host '=== Firmware ==='
Get-VMFirmware -VMName $VmName | Format-List SecureBoot,SecureBootTemplate,BootOrder

Write-Host '=== Storage ==='
Get-VMHardDiskDrive -VMName $VmName | Format-Table Path,ControllerType,ControllerLocation -AutoSize
Get-VMDvdDrive    -VMName $VmName    | Format-Table Path,ControllerType,ControllerLocation -AutoSize

Write-Host '=== Network ==='
Get-VMNetworkAdapter -VMName $VmName | Format-List Name,SwitchName,Status,MacAddress,IPAddresses

Write-Host '=== TPM ==='
Get-VMSecurity -VMName $VmName | Format-List TpmEnabled,KeyStorageDriveEnabled,EncryptStateAndVmMigrationTraffic
