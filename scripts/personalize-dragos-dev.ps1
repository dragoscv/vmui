# vmui — cosmetic/UX personalization for the "dragos-dev" guest.
#
# Split out from provision-dragos-dev.ps1 because these are HKCU-scoped user
# preferences rather than machine provisioning, and they need Explorer to be
# restarted to take effect. Safe to re-run.
#
# Applies: dark mode (apps + system + default profile), black desktop, the
# Windows 10 classic right-click context menu, and developer-friendly Explorer
# defaults.
[CmdletBinding()]
param(
  [string]$VmName   = 'dragos-dev',
  [string]$Username = 'dragos',
  [string]$Password = '',
  # Windows 11 centres the taskbar by default; 'Left' restores the Win10 look.
  [ValidateSet('Center', 'Left')]
  [string]$TaskbarAlignment = 'Center'
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib\guest-credentials.ps1"

if (-not $Password) { $Password = $env:DRAGOS_DEV_PASS }
if (-not $Password) {
  Write-Error "No password. Set `$env:DRAGOS_DEV_PASS or add DRAGOS_DEV_PASS to .private/credentials.env."
  exit 2
}

$secure = ConvertTo-SecureString $Password -AsPlainText -Force
$cred   = New-Object System.Management.Automation.PSCredential("$VmName\$Username", $secure)

# TaskbarAl: 0 = left, 1 = centre.
$taskbarAl = if ($TaskbarAlignment -eq 'Left') { 0 } else { 1 }

Invoke-Command -VMName $VmName -Credential $cred -ArgumentList $taskbarAl -ScriptBlock {
  param([int]$TaskbarAl)
  $ErrorActionPreference = 'SilentlyContinue'

  # -- Dark mode -------------------------------------------------------------
  $themes = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize'
  if (-not (Test-Path $themes)) { New-Item $themes -Force | Out-Null }
  New-ItemProperty $themes -Name AppsUseLightTheme    -Value 0 -PropertyType DWord -Force | Out-Null
  New-ItemProperty $themes -Name SystemUsesLightTheme -Value 0 -PropertyType DWord -Force | Out-Null
  New-ItemProperty $themes -Name EnableTransparency   -Value 0 -PropertyType DWord -Force | Out-Null

  # Same defaults for future profiles, via the Default User hive.
  reg load HKU\vmuiDef C:\Users\Default\NTUSER.DAT 2>$null | Out-Null
  reg add "HKU\vmuiDef\SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize" /v AppsUseLightTheme    /t REG_DWORD /d 0 /f 2>$null | Out-Null
  reg add "HKU\vmuiDef\SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize" /v SystemUsesLightTheme /t REG_DWORD /d 0 /f 2>$null | Out-Null
  [gc]::Collect(); Start-Sleep 1
  reg unload HKU\vmuiDef 2>$null | Out-Null

  # Solid black desktop — far cheaper to stream over RDP than a photo.
  New-ItemProperty 'HKCU:\Control Panel\Desktop' -Name Wallpaper  -Value ''      -PropertyType String -Force | Out-Null
  New-ItemProperty 'HKCU:\Control Panel\Colors'  -Name Background -Value '0 0 0' -PropertyType String -Force | Out-Null

  # -- Classic (Windows 10) right-click context menu -------------------------
  # Registering the Win11 command-bar CLSID with an EMPTY InprocServer32
  # default makes the shell fail to load it and fall back to the full legacy
  # menu, removing the "Show more options" indirection.
  $clsid = '{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}'
  $base  = "HKCU:\Software\Classes\CLSID\$clsid"
  New-Item -Path "$base\InprocServer32" -Force | Out-Null
  Set-ItemProperty -Path "$base\InprocServer32" -Name '(Default)' -Value '' -Force

  # -- Explorer defaults for a dev box ---------------------------------------
  $adv = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
  Set-ItemProperty $adv -Name HideFileExt -Value 0 -Type DWord -Force  # show extensions
  Set-ItemProperty $adv -Name Hidden      -Value 1 -Type DWord -Force  # show hidden files
  Set-ItemProperty $adv -Name LaunchTo    -Value 1 -Type DWord -Force  # open to This PC
  Set-ItemProperty $adv -Name TaskbarAl   -Value $TaskbarAl -Type DWord -Force  # 0=left 1=centre

  # Broadcast the theme change, then restart Explorer so the CLSID block and
  # the Advanced flags are picked up.
  Add-Type @'
using System; using System.Runtime.InteropServices;
public class VmuiBroadcast {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam,
    string lParam, uint flags, uint timeout, out IntPtr result);
}
'@
  $res = [IntPtr]::Zero
  [VmuiBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [IntPtr]::Zero, 'ImmersiveColorSet', 2, 3000, [ref]$res) | Out-Null
  rundll32.exe user32.dll, UpdatePerUserSystemParameters
  Get-Process explorer -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep 4

  [pscustomobject]@{
    AppsDark        = (Get-ItemProperty $themes).AppsUseLightTheme -eq 0
    SystemDark      = (Get-ItemProperty $themes).SystemUsesLightTheme -eq 0
    Transparency    = (Get-ItemProperty $themes).EnableTransparency
    ClassicMenu     = (Test-Path "$base\InprocServer32") -and
                      ('' -eq (Get-ItemProperty "$base\InprocServer32" -Name '(Default)').'(Default)')
    ShowExtensions  = (Get-ItemProperty $adv).HideFileExt -eq 0
    ShowHidden      = (Get-ItemProperty $adv).Hidden -eq 1
    TaskbarAlign    = if ((Get-ItemProperty $adv).TaskbarAl -eq 1) { 'Center' } else { 'Left' }
    ExplorerRunning = [bool](Get-Process explorer -ErrorAction SilentlyContinue)
  }
} | Format-List
