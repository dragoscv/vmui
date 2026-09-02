#requires -version 7
<#
.SYNOPSIS
  Rebuild a project-server VM from the workstation template, in the order that
  actually works.

.DESCRIPTION
  ORDER MATTERS, and getting it wrong costs a rebuild. Docker Desktop (and the
  WSL2 features it needs) goes in FIRST, before anything else touches Windows
  optional features.

  What went wrong the first time, so nobody repeats it:
    * The template image ships with Hyper-V enabled. WSL2 reported
      "virtualization is not enabled on this machine" even though the host set
      ExposeVirtualizationExtensions and every CPU flag read True.
    * The tempting conclusion -- that the nested Hyper-V was stealing the
      virtualization extensions -- is WRONG. WSL2 runs ON TOP OF Hyper-V.
    * Disabling Microsoft-Hyper-V deleted vmcompute.exe (the Host Compute
      Service that hosts the WSL2 utility VM) and re-enabling it does NOT bring
      it back: DISM reports "operation completed successfully" in 9 seconds and
      the file is still absent. Copying the binary out of WinSxS by hand gets a
      service that will not start, because servicing also writes COM
      registration a file copy cannot reproduce.
    * At that point the component store is unrepairable by command and the VM
      needs rebuilding. Hence this script.

  The real fix is simply to let the pending servicing reboot complete before
  touching anything else, and never to disable Hyper-V in the guest.

.EXAMPLE
  .\rebuild-project-server.ps1 -Name brivio-dev -Template mihai-dev
#>
param(
    [string]$Name = 'brivio-dev',
    [string]$Template = 'mihai-dev',
    [string]$DiskRoot = 'E:\Hyper-V',
    [int]$MemoryGB = 32,
    [int]$Cpu = 12,
    [int]$DiskGB = 250,
    [string]$Switch = 'Windows 11 Enterprise'
)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1')
function Step($m) { Write-Host ''; Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "    $m" -ForegroundColor Green }

$src = (Get-VMHardDiskDrive -VMName $Template).Path
if (-not (Test-Path $src)) { throw "discul sablon lipseste: $src" }
if ((Get-VMSnapshot -VMName $Template -ErrorAction SilentlyContinue)) {
    throw "$Template are checkpoint-uri; sterge-le intai sau copiezi un .avhdx"
}

Step "1. opresc $Template pentru o copie consistenta"
$wasRunning = (Get-VM $Template).State -eq 'Running'
if ($wasRunning) {
    Stop-VM $Template -Force
    do { Start-Sleep 2 } until ((Get-VM $Template).State -eq 'Off')
}
Ok 'oprit'

Step "2. sterg $Name daca exista"
if (Get-VM $Name -ErrorAction SilentlyContinue) {
    Stop-VM $Name -Force -ErrorAction SilentlyContinue
    do { Start-Sleep 2 } until ((Get-VM $Name).State -eq 'Off')
    Remove-VM $Name -Force
    Ok 'definitie stearsa'
}
$dir = Join-Path $DiskRoot $Name
$vhd = Join-Path $dir "$Name.vhdx"
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Step '3. copiez discul'
$t0 = Get-Date
Copy-Item $src $vhd
Ok ('{0:N0} GB in {1:N0} s' -f ((Get-Item $vhd).Length / 1GB), ((Get-Date) - $t0).TotalSeconds)
if ((Get-VHD $vhd).Size -lt ($DiskGB * 1GB)) {
    Resize-VHD -Path $vhd -SizeBytes ($DiskGB * 1GB)
    Ok "extins la $DiskGB GB"
}
if ($wasRunning) { Start-VM $Template }

Step '4. creez VM-ul'
New-VM -Name $Name -Generation 2 -MemoryStartupBytes ($MemoryGB * 1GB) `
    -VHDPath $vhd -Path $DiskRoot -SwitchName $Switch | Out-Null
Set-VM -Name $Name -ProcessorCount $Cpu -AutomaticCheckpointsEnabled $false `
    -CheckpointType Production -AutomaticStopAction ShutDown
Set-VMMemory -VMName $Name -DynamicMemoryEnabled $false          # nested virt needs static RAM
Set-VMProcessor -VMName $Name -ExposeVirtualizationExtensions $true
Get-VMNetworkAdapter -VMName $Name | Set-VMNetworkAdapter -MacAddressSpoofing On
Set-VMKeyProtector -VMName $Name -NewLocalKeyProtector           # Windows 11 refuses to boot without vTPM
Enable-VMTPM -VMName $Name
Set-VMFirmware -VMName $Name -EnableSecureBoot On `
    -FirstBootDevice (Get-VMHardDiskDrive -VMName $Name)          # cloned disks default to PXE
Ok "$MemoryGB GB, $Cpu vCPU, nested virt on"

Step '5. pornesc'
Start-VM $Name
do { Start-Sleep 5 } until ((Get-VMIntegrationService -VMName $Name -Name Heartbeat).PrimaryStatusDescription -eq 'OK')
Start-Sleep 30
Ok 'heartbeat OK'

Write-Host ''
Write-Host '  URMATORII PASI, IN ACEASTA ORDINE:' -ForegroundColor Yellow
Write-Host "    1. .\provision-docker.ps1 -Vm $Name      <- INTAI, inainte de orice"
Write-Host "    2. .\provision-project-server.ps1        (repo, conturi, sshd)"
Write-Host "    3. .\tailscale-fleet.ps1 -Enroll $Name -Tag project-server"
Write-Host "    4. .\restore-brivio-data.ps1 -Vm $Name"
