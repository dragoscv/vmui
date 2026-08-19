# vmui — connect to the macOS guest over SPICE instead of VNC.
#
# Why SPICE beats QEMU's built-in VNC here:
#   - It attaches to QEMU's display device on the HOST, so it receives damage
#     rectangles directly from the emulated VGA. No guest-side capture, and no
#     full-frame polling the way a generic VNC client does.
#   - boot-mac.sh already enables adaptive image compression
#     (auto_glz + jpeg-wan + zlib-glz), so busy regions go out as JPEG and flat
#     regions as lossless LZ, chosen per-tile.
#   - Verified 2026-08-19: port 5930 answers a SPICE handshake (magic REDQ,
#     protocol 2.2, ticketing disabled).
#
# Requires VirtViewer on Windows (winget install RedHat.VirtViewer).
#
# Usage:
#   pwsh -File scripts\mac-connect-spice.ps1
#   pwsh -File scripts\mac-connect-spice.ps1 -Host 172.23.206.203

param(
  [string]$SpiceHost = "127.0.0.1",
  [int]$SpicePort = 5930,
  [switch]$Fullscreen
)

$ErrorActionPreference = "Stop"

# remote-viewer ships inside the VirtViewer install directory.
$viewer = Get-ChildItem "$env:ProgramFiles\VirtViewer*\bin\remote-viewer.exe" -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $viewer) {
  $viewer = Get-ChildItem "${env:ProgramFiles(x86)}\VirtViewer*\bin\remote-viewer.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $viewer) {
  throw "remote-viewer.exe not found. Install with: winget install RedHat.VirtViewer"
}

# Fail fast with a clear message rather than letting the viewer hang.
$probe = Test-NetConnection -ComputerName $SpiceHost -Port $SpicePort -WarningAction SilentlyContinue
if (-not $probe.TcpTestSucceeded) {
  throw "Nothing is listening on ${SpiceHost}:${SpicePort}. Is the VM running? (.\scripts\mac-branch.ps1 -List)"
}

$uri = "spice://${SpiceHost}:${SpicePort}"
$args = @($uri)
if ($Fullscreen) { $args += "--full-screen" }

Write-Host "Launching: $viewer $uri"
Start-Process -FilePath $viewer -ArgumentList $args
Write-Host "Connected via SPICE. VNC on :5900 remains available as a fallback."
