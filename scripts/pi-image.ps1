<#
.SYNOPSIS
  Write Raspberry Pi OS Lite (64-bit) to a USB stick / SD card with cloud-init
  customisation (hostname homepi, SSH key only, Docker, udev rules).

.EXAMPLE
  pwsh -File scripts\pi-image.ps1 -DiskNumber 4
  Refuses system disks; prints the target and waits for -Confirm unless -Force.
#>
param(
  [Parameter(Mandatory)] [int] $DiskNumber,
  [string] $PubKey = "$env:USERPROFILE\.ssh\id_ed25519.pub",
  [switch] $Force
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$imager = 'C:\Program Files\Raspberry Pi Ltd\Imager\rpi-imager.exe'
if (-not (Test-Path $imager)) { throw "rpi-imager missing: winget install RaspberryPiFoundation.RaspberryPiImager" }

$disk = Get-Disk -Number $DiskNumber
if ($disk.IsSystem -or $disk.IsBoot -or $disk.BusType -notin 'USB', 'SD', 'MMC') {
  throw "disk $DiskNumber ($($disk.FriendlyName), $($disk.BusType)) is not a removable target"
}
$sizeGB = [math]::Round($disk.Size / 1GB, 1)
Write-Host "target: disk $DiskNumber  $($disk.FriendlyName)  $sizeGB GB  serial $($disk.SerialNumber)"
if (-not $Force) {
  $a = Read-Host "type the disk number to ERASE it"
  if ($a -ne "$DiskNumber") { throw 'aborted' }
}

$list = Invoke-RestMethod 'https://downloads.raspberrypi.org/os_list_imagingutility_v4.json'
$lite = ($list.os_list | Where-Object name -like 'Raspberry Pi OS (other)').subitems |
  Where-Object name -eq 'Raspberry Pi OS Lite (64-bit)' | Select-Object -First 1
if (-not $lite) { throw 'Lite 64-bit image not found in the OS list' }
Write-Host "image:  $($lite.name) $($lite.release_date)"

$tmp = Join-Path $root '.copilot-tmp\pi'
New-Item -ItemType Directory -Force $tmp | Out-Null
$pub = (Get-Content $PubKey -Raw).Trim()
$ud = (Get-Content (Join-Path $root 'pi\cloud-init\user-data.tmpl') -Raw).Replace('${SSH_PUBKEY}', $pub)
$udPath = Join-Path $tmp 'user-data'
[IO.File]::WriteAllText($udPath, ($ud -replace "`r`n", "`n"), [Text.UTF8Encoding]::new($false))
$ncPath = Join-Path $root 'pi\cloud-init\network-config'

# Imager wants \\.\PhysicalDriveN on Windows
$dst = "\\.\PhysicalDrive$DiskNumber"
$args = @('--cli', '--disable-eject', '--cloudinit-userdata', $udPath, '--cloudinit-networkconfig', $ncPath)
if ($lite.image_download_sha256) { $args += @('--sha256', $lite.image_download_sha256) }
$args += @($lite.url, $dst)
Write-Host "writing (download + write + verify, 5-15 min)..."
$p = Start-Process -FilePath $imager -ArgumentList $args -Verb RunAs -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "rpi-imager exited $($p.ExitCode)" }
Write-Host "done. Move the stick to the Pi, power it on, wait ~4 min for cloud-init, then: ssh dragos@homepi.local"
