# vmui — post-install provisioning for the "dragos-dev" VS Code tunnel host.
#
# Runs entirely over PowerShell Direct (Hyper-V VMBus), so it works before the
# guest has usable networking and never needs an inbound port on the host.
#
# Steps inside the guest:
#   1. Debloat: remove consumer appx packages, disable Widgets / Copilot /
#      Recall / consumer content delivery, minimise telemetry, trim visual
#      effects and background services. Defender is left ENABLED.
#   2. Install Tailscale (MSI, unattended).
#   3. Lock RDP down to the Tailscale CGNAT range (100.64.0.0/10) only.
#   4. Install the VS Code CLI to C:\vscode and stage the tunnel commands.
#
# Tailscale login and VS Code tunnel login are interactive by design and are
# printed as the final manual steps.
[CmdletBinding()]
param(
  [string]$VmName        = 'dragos-dev',
  [string]$Username      = 'dragos',
  [string]$Password      = '',
  [int]$WaitMinutes      = 30,
  [switch]$SkipDebloat,
  [switch]$SkipTailscale,
  [switch]$SkipVsCode
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib\win-credentials.ps1"

if (-not $Password) { $Password = $env:DRAGOS_DEV_PASS }
if (-not $Password) {
  Write-Error "No password. Set `$env:DRAGOS_DEV_PASS or add DRAGOS_DEV_PASS to .private/credentials.env."
  exit 2
}

$vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if (-not $vm) { Write-Error "VM '$VmName' not found. Run scripts/setup-dragos-dev.ps1 first."; exit 3 }
if ($vm.State -ne 'Running') { Write-Host "Starting '$VmName'..."; Start-VM -Name $VmName }

$secure = ConvertTo-SecureString $Password -AsPlainText -Force
$cred   = New-Object System.Management.Automation.PSCredential("$VmName\$Username", $secure)

# ---------------------------------------------------------------------------
# Wait for PowerShell Direct. It only answers once the guest has completed
# OOBE and the VM management integration service is up.
# ---------------------------------------------------------------------------
Write-Host "[wait] Polling PowerShell Direct (up to $WaitMinutes min)..."
$deadline = (Get-Date).AddMinutes($WaitMinutes)
$ready = $false
while ((Get-Date) -lt $deadline) {
  try {
    $probe = Invoke-Command -VMName $VmName -Credential $cred -ErrorAction Stop `
      -ScriptBlock { Test-Path 'C:\vmui-setup-done.txt' }
    if ($probe) { $ready = $true; break }
    Write-Host "      guest reachable, first-logon commands still running..."
  } catch {
    Write-Host "      not ready yet ($($_.Exception.Message.Split([char]10)[0]))"
  }
  Start-Sleep -Seconds 20
}
if (-not $ready) { Write-Error "Guest never became ready within $WaitMinutes minutes."; exit 4 }
Write-Host "[wait] Guest is ready."

# ---------------------------------------------------------------------------
# 1. Debloat.
# ---------------------------------------------------------------------------
if (-not $SkipDebloat) {
  Write-Host "[1/4] Debloating..."
  Invoke-Command -VMName $VmName -Credential $cred -ScriptBlock {
    $ErrorActionPreference = 'SilentlyContinue'
    $ProgressPreference    = 'SilentlyContinue'

    # -- Remove consumer appx packages (provisioned + installed). ------------
    $bloat = @(
      'Microsoft.BingNews', 'Microsoft.BingWeather', 'Microsoft.BingSearch',
      'Microsoft.GamingApp', 'Microsoft.GetHelp', 'Microsoft.Getstarted',
      'Microsoft.MicrosoftOfficeHub', 'Microsoft.MicrosoftSolitaireCollection',
      'Microsoft.MicrosoftStickyNotes', 'Microsoft.People',
      'Microsoft.PowerAutomateDesktop', 'Microsoft.Todos',
      'Microsoft.WindowsAlarms', 'Microsoft.WindowsCamera',
      'Microsoft.WindowsFeedbackHub', 'Microsoft.WindowsMaps',
      'Microsoft.WindowsSoundRecorder', 'Microsoft.Xbox.TCUI',
      'Microsoft.XboxGameOverlay', 'Microsoft.XboxGamingOverlay',
      'Microsoft.XboxIdentityProvider', 'Microsoft.XboxSpeechToTextOverlay',
      'Microsoft.YourPhone', 'Microsoft.ZuneMusic', 'Microsoft.ZuneVideo',
      'Microsoft.Copilot', 'Microsoft.Windows.Ai.Copilot.Provider',
      'MicrosoftCorporationII.QuickAssist', 'MicrosoftTeams',
      'MSTeams', 'Clipchamp.Clipchamp', 'Microsoft.OutlookForWindows'
    )
    foreach ($name in $bloat) {
      Get-AppxPackage -AllUsers -Name $name | Remove-AppxPackage -AllUsers
      Get-AppxProvisionedPackage -Online |
        Where-Object DisplayName -EQ $name |
        Remove-AppxProvisionedPackage -Online -AllUsers | Out-Null
    }

    function Set-Reg($path, $name, $value, $type = 'DWord') {
      if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
      New-ItemProperty -Path $path -Name $name -Value $value -PropertyType $type -Force | Out-Null
    }

    # -- Content delivery / suggested apps / ads. ----------------------------
    $cdm = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent'
    Set-Reg $cdm 'DisableWindowsConsumerFeatures' 1
    Set-Reg $cdm 'DisableCloudOptimizedContent'   1
    Set-Reg $cdm 'DisableConsumerAccountStateContent' 1
    $cdmUser = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
    foreach ($v in @('SilentInstalledAppsEnabled', 'SystemPaneSuggestionsEnabled',
                     'SoftLandingEnabled', 'PreInstalledAppsEnabled',
                     'OemPreInstalledAppsEnabled', 'ContentDeliveryAllowed',
                     'SubscribedContent-338388Enabled', 'SubscribedContent-338389Enabled',
                     'SubscribedContent-353698Enabled', 'RotatingLockScreenOverlayEnabled')) {
      Set-Reg $cdmUser $v 0
    }

    # -- Telemetry to the minimum permitted on Enterprise (Security = 0). ----
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection' 'AllowTelemetry' 0
    Set-Reg 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection' 'AllowTelemetry' 0
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection' 'DoNotShowFeedbackNotifications' 1

    # -- Widgets, Copilot, Recall, Search highlights. ------------------------
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Dsh' 'AllowNewsAndInterests' 0
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot' 'TurnOffWindowsCopilot' 1
    Set-Reg 'HKCU:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot' 'TurnOffWindowsCopilot' 1
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsAI' 'DisableAIDataAnalysis' 1
    Set-Reg 'HKCU:\SOFTWARE\Policies\Microsoft\Windows\WindowsAI' 'DisableAIDataAnalysis' 1
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search' 'AllowCortana' 0
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search' 'EnableDynamicContentInWSB' 0
    Set-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'TaskbarDa' 0
    Set-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'TaskbarMn' 0
    Set-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced' 'ShowCopilotButton' 0

    # -- Store auto-update of apps (keeps the box quiet + saves CPU). --------
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\WindowsStore' 'AutoDownload' 2

    # -- Lean UI: no animations/transparency (big win over RDP). -------------
    Set-Reg 'HKCU:\Control Panel\Desktop\WindowMetrics' 'MinAnimate' '0' 'String'
    Set-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize' 'EnableTransparency' 0
    Set-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\DWM' 'EnableAeroPeek' 0
    Set-Reg 'HKCU:\Control Panel\Desktop' 'DragFullWindows' '0' 'String'
    # 2 = "Adjust for best performance".
    Set-Reg 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' 'VisualFXSetting' 2

    # -- Services that are pure overhead on a headless tunnel host. ----------
    foreach ($svc in @('DiagTrack', 'dmwappushservice', 'RetailDemo',
                       'MapsBroker', 'XblAuthManager', 'XblGameSave',
                       'XboxGipSvc', 'XboxNetApiSvc', 'WSearch', 'SysMain')) {
      Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
      Set-Service  -Name $svc -StartupType Disabled -ErrorAction SilentlyContinue
    }

    # -- Scheduled tasks that phone home. ------------------------------------
    foreach ($t in @('\Microsoft\Windows\Application Experience\Microsoft Compatibility Appraisal',
                     '\Microsoft\Windows\Application Experience\ProgramDataUpdater',
                     '\Microsoft\Windows\Customer Experience Improvement Program\Consolidator',
                     '\Microsoft\Windows\Customer Experience Improvement Program\UsbCeip',
                     '\Microsoft\Windows\Feedback\Siuf\DmClient')) {
      Disable-ScheduledTask -TaskPath (Split-Path $t) -TaskName (Split-Path $t -Leaf) -ErrorAction SilentlyContinue | Out-Null
    }

    # -- Never sleep / never hibernate; a tunnel host must stay reachable. ---
    powercfg /setactive SCHEME_MIN 2>$null
    powercfg /change standby-timeout-ac 0
    powercfg /change monitor-timeout-ac 0
    powercfg /change hibernate-timeout-ac 0
    powercfg /hibernate off

    'debloat-ok'
  } | ForEach-Object { Write-Host "      $_" }
}

# ---------------------------------------------------------------------------
# 2. Tailscale.
# ---------------------------------------------------------------------------
if (-not $SkipTailscale) {
  Write-Host "[2/4] Installing Tailscale..."
  Invoke-Command -VMName $VmName -Credential $cred -ScriptBlock {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference    = 'SilentlyContinue'

    $exe = 'C:\Program Files\Tailscale\tailscale.exe'
    if (Test-Path $exe) { return "tailscale already installed" }

    $msi = 'C:\Windows\Temp\tailscale.msi'
    # Stable channel, always-current MSI published by Tailscale.
    Invoke-WebRequest -UseBasicParsing `
      -Uri 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi' `
      -OutFile $msi

    $p = Start-Process msiexec.exe -Wait -PassThru `
         -ArgumentList @('/i', "`"$msi`"", '/quiet', '/norestart',
                         'TS_UNATTENDEDMODE=always', 'TS_ALLOWINCOMINGCONNECTIONS=always')
    if ($p.ExitCode -ne 0) { throw "msiexec failed (exit $($p.ExitCode))" }
    Remove-Item $msi -Force -ErrorAction SilentlyContinue
    "tailscale installed"
  } | ForEach-Object { Write-Host "      $_" }
}

# ---------------------------------------------------------------------------
# 3. RDP: enabled, but only reachable over the Tailscale CGNAT range.
# ---------------------------------------------------------------------------
Write-Host "[3/4] Restricting RDP to Tailscale (100.64.0.0/10)..."
Invoke-Command -VMName $VmName -Credential $cred -ScriptBlock {
  $ErrorActionPreference = 'SilentlyContinue'

  # RDP service on, NLA on (RDP over Tailscale is already encrypted, but NLA
  # blocks pre-auth session allocation).
  Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0
  Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name UserAuthentication -Value 1
  Set-Service -Name TermService -StartupType Automatic
  Start-Service TermService

  # Disable every stock "Remote Desktop" firewall rule, then add one scoped
  # rule. Leaving the stock rules enabled would keep RDP open on the NAT NIC.
  Get-NetFirewallRule -Group '@FirewallAPI.dll,-28752' -ErrorAction SilentlyContinue |
    Set-NetFirewallRule -Enabled False

  Remove-NetFirewallRule -Name 'RDP-Tailscale-Only' -ErrorAction SilentlyContinue
  New-NetFirewallRule -Name 'RDP-Tailscale-Only' `
    -DisplayName 'Remote Desktop (Tailscale only)' `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3389 `
    -RemoteAddress '100.64.0.0/10' -Profile Any -Enabled True | Out-Null

  # Same treatment for OpenSSH, which the autounattend opened on all profiles.
  Remove-NetFirewallRule -Name 'OpenSSH-Server-In-TCP-vmui' -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -Name 'SSH-Tailscale-Only' -ErrorAction SilentlyContinue
  New-NetFirewallRule -Name 'SSH-Tailscale-Only' `
    -DisplayName 'OpenSSH Server (Tailscale only)' `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 `
    -RemoteAddress '100.64.0.0/10' -Profile Any -Enabled True | Out-Null

  'rdp-locked-to-tailscale'
} | ForEach-Object { Write-Host "      $_" }

# ---------------------------------------------------------------------------
# 4. VS Code CLI (tunnel host).
# ---------------------------------------------------------------------------
if (-not $SkipVsCode) {
  Write-Host "[4/4] Installing VS Code CLI..."
  Invoke-Command -VMName $VmName -Credential $cred -ScriptBlock {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference    = 'SilentlyContinue'

    $dir = 'C:\vscode'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $zip = Join-Path $env:TEMP 'vscode-cli.zip'

    Invoke-WebRequest -UseBasicParsing `
      -Uri 'https://code.visualstudio.com/sha/download?build=stable&os=cli-win32-x64' `
      -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue

    # Put code.exe on the machine PATH for interactive sessions.
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if ($machinePath -notlike "*$dir*") {
      [Environment]::SetEnvironmentVariable('Path', "$machinePath;$dir", 'Machine')
    }

    (Get-Item (Join-Path $dir 'code.exe')).VersionInfo.FileVersion
  } | ForEach-Object { Write-Host "      code.exe $_" }
}

# ---------------------------------------------------------------------------
# Summary + the two interactive steps that remain.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== dragos-dev provisioned ==="
Write-Host "  user     : $Username"
Write-Host "  password : (see .private/credentials.env -> DRAGOS_DEV_PASS)"
Write-Host ""
Write-Host "Remaining interactive steps -- open the console:"
Write-Host "    vmconnect.exe localhost $VmName"
Write-Host ""
Write-Host "  1. Join the tailnet (browser login):"
Write-Host "       & 'C:\Program Files\Tailscale\tailscale.exe' up --hostname=dragos-dev --accept-dns=false"
Write-Host "       & 'C:\Program Files\Tailscale\tailscale.exe' ip -4"
Write-Host ""
Write-Host "  2. Authenticate + install the VS Code tunnel as a service:"
Write-Host "       C:\vscode\code.exe tunnel user login --provider github"
Write-Host "       C:\vscode\code.exe tunnel service install --accept-server-license-terms --name dragos-dev"
Write-Host ""
Write-Host "Then from your laptop (also on the tailnet):"
Write-Host "    mstsc /v:dragos-dev            # RDP over Tailscale"
Write-Host "    https://vscode.dev/tunnel/dragos-dev"
