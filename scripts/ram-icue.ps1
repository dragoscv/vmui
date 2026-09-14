#requires -version 7
<#
.SYNOPSIS
  Hand the DDR5 RGB to Corsair iCUE and take it away from Gigabyte Control Center.

.DESCRIPTION
  The Corsair Vengeance DDR5 sticks sit on the Intel IMC SMBus, which OpenRGB
  cannot reach on Z790 (PawnIO SmbusIntelSkylakeIMC: "unsupported", verified
  2026-09-14). Two things can drive them: GCC (RGBMemory) and iCUE. Both at
  once = the sticks flicker between two writers, so exactly one must own them.

  -Enable   iCUE services back to Automatic and started (needs elevation),
            GCC RGBMemory component disabled by renaming its folder, GCC restarted.
  -Disable  the reverse.
  -Status   who owns the RAM right now.
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(Mandatory, ParameterSetName = 'Enable')][switch]$Enable,
    [Parameter(Mandatory, ParameterSetName = 'Disable')][switch]$Disable,
    [Parameter(ParameterSetName = 'Status')][switch]$Status
)
$ErrorActionPreference = 'Stop'
$Services = 'CorsairDeviceControlService', 'CorsairDeviceListerService', 'CorsairCpuIdService', 'iCUEDevicePluginHost'
$GccDir = "$env:ProgramFiles\GIGABYTE\Control Center"
$RgbMem = Join-Path $GccDir 'RGBMemory'
$RgbMemOff = Join-Path $GccDir 'RGBMemory.disabled-by-vmui'
$Icue = "$env:ProgramFiles\Corsair\Corsair iCUE5 Software\iCUE.exe"
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')

function Show-Status {
    foreach ($s in $Services) {
        $svc = Get-Service $s -ErrorAction SilentlyContinue
        Write-Host ("  {0,-30} {1,-8} {2}" -f $s, $svc.Status, $svc.StartType) -ForegroundColor $(if ($svc.Status -eq 'Running') { 'Green' } else { 'Yellow' })
    }
    Write-Host ("  iCUE.exe                       {0}" -f $(if (Get-Process iCUE -ErrorAction SilentlyContinue) { 'running' } else { 'not running' }))
    Write-Host ("  GCC RGBMemory component        {0}" -f $(if (Test-Path $RgbMem) { 'ENABLED (GCC drives RAM)' } elseif (Test-Path $RgbMemOff) { 'disabled' } else { 'absent' }))
}

switch ($PSCmdlet.ParameterSetName) {
    'Enable' {
        if (-not $IsAdmin) { throw "needs elevation: Start-Process pwsh -Verb RunAs -ArgumentList '-File',`"$PSCommandPath`",'-Enable'" }
        Get-Process GCC -ErrorAction SilentlyContinue | Stop-Process -Force
        if (Test-Path $RgbMem) { Rename-Item $RgbMem (Split-Path $RgbMemOff -Leaf) }
        foreach ($s in $Services) { Set-Service $s -StartupType Automatic; Start-Service $s }
        Start-Process "$GccDir\GCC.exe" -ErrorAction SilentlyContinue
        if (-not (Get-Process iCUE -ErrorAction SilentlyContinue)) { Start-Process $Icue }
        Show-Status
    }
    'Disable' {
        if (-not $IsAdmin) { throw 'needs elevation' }
        Get-Process iCUE -ErrorAction SilentlyContinue | Stop-Process -Force
        foreach ($s in $Services) { Stop-Service $s -Force -ErrorAction SilentlyContinue; Set-Service $s -StartupType Disabled }
        if (Test-Path $RgbMemOff) { Rename-Item $RgbMemOff 'RGBMemory' }
        Show-Status
    }
    default { Show-Status }
}
