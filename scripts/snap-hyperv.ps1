# Capture a thumbnail of a Hyper-V VM's screen via WMI.
# Hyper-V's GetVirtualSystemThumbnailImage returns RGB565 pixel data.
# We don't write a BMP (header alignment is fragile); instead we save a PPM
# (text P6) which is universally viewable and trivial to produce.
[CmdletBinding()]
param(
  [string]$VmName = 'vmui-win',
  [string]$Out    = 'e:\gh\vmui\diag-hyperv.ppm',
  [int]$Width     = 1024,
  [int]$Height    = 768
)

$vm  = Get-WmiObject -Namespace root\virtualization\v2 -Class Msvm_ComputerSystem -Filter "ElementName='$VmName'"
if (-not $vm) { throw "VM '$VmName' not found." }
$svc = Get-WmiObject -Namespace root\virtualization\v2 -Class Msvm_VirtualSystemManagementService
$res = $svc.GetVirtualSystemThumbnailImage($vm.__PATH, $Width, $Height)
if ($res.ReturnValue -ne 0) { throw "GetVirtualSystemThumbnailImage RC=$($res.ReturnValue)" }
$bytes = [byte[]]$res.ImageData
Write-Host "thumbnail bytes: $($bytes.Length) (expected $($Width*$Height*2))"

# RGB565 -> RGB888 PPM
$header = "P6`n$Width $Height`n255`n"
$fs = [System.IO.File]::Create($Out)
try {
  $hdrBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $fs.Write($hdrBytes, 0, $hdrBytes.Length)
  $px = $Width * $Height
  $rgb = New-Object byte[] ($px * 3)
  for ($i = 0; $i -lt $px; $i++) {
    $lo = $bytes[$i*2]
    $hi = $bytes[$i*2 + 1]
    $val = ([int]$hi -shl 8) -bor [int]$lo
    $r5 = ($val -shr 11) -band 0x1F
    $g6 = ($val -shr 5)  -band 0x3F
    $b5 =  $val          -band 0x1F
    $rgb[$i*3]     = [byte](($r5 * 255) / 31)
    $rgb[$i*3 + 1] = [byte](($g6 * 255) / 63)
    $rgb[$i*3 + 2] = [byte](($b5 * 255) / 31)
  }
  $fs.Write($rgb, 0, $rgb.Length)
} finally { $fs.Close() }
Write-Host "saved $Out ($((Get-Item $Out).Length) bytes)"
