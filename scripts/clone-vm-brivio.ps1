<#
.SYNOPSIS
  Clone dragos-dev into a second working VM called "brivio".

.DESCRIPTION
  Produces a VM that can run ALONGSIDE dragos-dev. Anything that carries
  machine identity is changed, because two machines answering to the same name
  is the same class of problem as the tunnel process bomb: duplicate clients
  fighting over one identity.

  What changes:
    * VM name          dragos-dev  -> brivio
    * Windows hostname DRAGOS-DEV  -> BRIVIO
    * local account    dragos      -> brivio   (account name only)
    * Tailscale        re-registers as a new node
    * MAC address      regenerated, so DHCP hands out a distinct lease

  What deliberately does NOT change:
    * the profile folder stays C:\Users\dragos

      Windows renames the ACCOUNT but never the profile FOLDER. Moving it by
      hand means patching ProfileImagePath plus every absolute path baked into
      the registry and app configs — on this machine that already includes
      .copilot\agents and .claude\rules. The user chose the safe option; the
      path is cosmetic, `whoami` will say brivio.

.PARAMETER SkipShutdown
  Assume the VM is already off.

.NOTES
  Run elevated. Hyper-V cmdlets and Get-LocalUser require it.
  Source disk is 75.6 GB; allow ~10-20 min for the copy on an SSD.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$SourceVM = 'dragos-dev',
  [string]$NewVM = 'brivio',
  [string]$NewHostname = 'BRIVIO',
  [string]$NewUser = 'brivio',
  [string]$Root = 'E:\Hyper-V',
  [switch]$SkipShutdown
)

$ErrorActionPreference = 'Stop'

function Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run elevated (Run as Administrator).' -ForegroundColor Red; exit 1
}

if (Get-VM $NewVM -EA SilentlyContinue) {
  Write-Host "A VM named '$NewVM' already exists. Remove it first, or pass -NewVM." -ForegroundColor Red
  exit 1
}

$src = Get-VM $SourceVM
$srcDisk = (Get-VMHardDiskDrive $SourceVM).Path
$srcVhd = Get-VHD $srcDisk
$destDir = Join-Path $Root $NewVM
$destDisk = Join-Path $destDir (Split-Path $srcDisk -Leaf)

# Free space: the copy is dynamic, so the on-disk size is what matters.
$need = [math]::Round($srcVhd.FileSize / 1GB, 1)
$free = [math]::Round((Get-PSDrive ($Root[0])).Free / 1GB, 1)
Write-Host "source disk $need GB, free on $($Root[0]): $free GB"
if ($free -lt ($need * 1.2)) {
  Write-Host 'Not enough headroom (want 1.2x the source size).' -ForegroundColor Red; exit 1
}

# --- 1. stop -----------------------------------------------------------------
if (-not $SkipShutdown) {
  Step 1 "Shutting down $SourceVM (graceful)"
  if ($PSCmdlet.ShouldProcess($SourceVM, 'Stop-VM')) {
    Stop-VM $SourceVM -Force:$false
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-VM $SourceVM).State -ne 'Off' -and (Get-Date) -lt $deadline) { Start-Sleep 3 }
    if ((Get-VM $SourceVM).State -ne 'Off') {
      Write-Host 'Did not shut down in 5 min. Aborting rather than forcing.' -ForegroundColor Red
      exit 1
    }
  }
} else {
  if ((Get-VM $SourceVM).State -ne 'Off') { Write-Host 'VM is not Off.' -ForegroundColor Red; exit 1 }
}

# --- 2. copy the disk --------------------------------------------------------
Step 2 "Copying the disk to $destDisk"
if ($PSCmdlet.ShouldProcess($destDisk, 'copy VHDX')) {
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  $sw = [Diagnostics.Stopwatch]::StartNew()
  Copy-Item $srcDisk $destDisk
  $sw.Stop()
  Write-Host ("copied in {0:N1} min" -f $sw.Elapsed.TotalMinutes) -ForegroundColor Green
}

# --- 3. restart the source immediately ---------------------------------------
# Do this BEFORE building the clone: the user is working in it, so downtime
# should cover the copy only, not the rest of the script.
Step 3 "Restarting $SourceVM so you can get back to work"
if ($PSCmdlet.ShouldProcess($SourceVM, 'Start-VM')) {
  Start-VM $SourceVM
  Write-Host "$SourceVM is starting." -ForegroundColor Green
}

# --- 4. create the clone -----------------------------------------------------
Step 4 "Creating VM $NewVM"
if ($PSCmdlet.ShouldProcess($NewVM, 'New-VM')) {
  New-VM -Name $NewVM -MemoryStartupBytes $src.MemoryStartup -VHDPath $destDisk `
    -Generation $src.Generation -Path $Root | Out-Null
  Set-VM -Name $NewVM -ProcessorCount $src.ProcessorCount -AutomaticStopAction Save
  # Static memory, matching the source after the ballooning incident.
  Set-VMMemory $NewVM -DynamicMemoryEnabled $false -StartupBytes $src.MemoryStartup

  # Gen 2 boots UEFI and needs Secure Boot configured the same way.
  if ($src.Generation -eq 2) {
    $sb = Get-VMFirmware $SourceVM
    Set-VMFirmware $NewVM -EnableSecureBoot $sb.SecureBoot -SecureBootTemplate $sb.SecureBootTemplate
    $bootDisk = Get-VMHardDiskDrive $NewVM
    Set-VMFirmware $NewVM -FirstBootDevice $bootDisk
  }

  # Same switch, but a fresh MAC: an identical MAC on one switch is an
  # immediate address conflict.
  $srcNic = Get-VMNetworkAdapter $SourceVM | Select-Object -First 1
  Get-VMNetworkAdapter $NewVM | Connect-VMNetworkAdapter -SwitchName $srcNic.SwitchName
  Set-VMNetworkAdapter $NewVM -DynamicMacAddress

  if ((Get-VMIntegrationService $SourceVM | Where-Object Name -eq 'Guest Service Interface').Enabled) {
    Enable-VMIntegrationService $NewVM -Name 'Guest Service Interface'
  }
  Write-Host "created: $NewVM" -ForegroundColor Green
}

Write-Host ''
Write-Host '=== next: rename inside the guest =====================' -ForegroundColor Yellow
Write-Host @"
The clone still believes it is DRAGOS-DEV. Start it, sign in as 'dragos',
and run the second script BEFORE putting it on the network alongside the
original — two machines with one hostname and one Tailscale identity will
fight, and Tailscale will silently reassign the node.

  Start-VM $NewVM
  # then, inside the guest, elevated:
  #   rename-guest-brivio.ps1
"@ -ForegroundColor Gray
