#requires -version 7
<#
.SYNOPSIS
  Screen-reactive lighting for the movie PC: HyperHDR + bridges to every
  light we own, wired into Home Assistant.

.DESCRIPTION
  Pipeline (all on this PC, one process each, started at logon):

    HyperHDR 22 (DX11 grabber, HDR tone-mapped, 60 fps)
      inst 0  "DX Light (monitor)"    udpraw :19446 -> ambilight/dxlight_bridge.py -> USB HID strip, 65 LEDs
      inst 1  "PC glow (OpenRGB)"     udpraw :19447 -> ambilight/openrgb_bridge.py -> OpenRGB SDK :6742
      inst 2  "Room lights (HA)"      home_assistant driver -> Desk Light Bar, BLE strip (+ bulbs when paired)
      MQTT client -> Mosquitto on the appliance, topic HyperHDR/JsonAPI

  Home Assistant (ambilight/ha-scenes.yaml, a HA package) owns the modes:
  movie / music / off, a notify flash, and two webhooks the phone can hit.

  Why HyperHDR and not DX Light: DX Light drives one strip from one screen
  with no API. HyperHDR does HDR correctly on Windows, has per-device LED
  geometry, and talks to everything else through standard outputs.

.EXAMPLE
  ambilight.ps1 -Status
  ambilight.ps1 -Install          # logon tasks for HyperHDR, OpenRGB, both bridges; DX Light out of autostart
  ambilight.ps1 -Configure        # (re)write HyperHDR instances from this file
  ambilight.ps1 -InstallHaScenes  # push ha-scenes.yaml to the appliance
  ambilight.ps1 -Mode movie|music|off
  ambilight.ps1 -Notify -Color 0,120,255
  ambilight.ps1 -Uninstall
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')][switch]$Status,
    [Parameter(Mandatory, ParameterSetName = 'Install')][switch]$Install,
    [Parameter(Mandatory, ParameterSetName = 'Uninstall')][switch]$Uninstall,
    [Parameter(Mandatory, ParameterSetName = 'Configure')][switch]$Configure,
    [Parameter(Mandatory, ParameterSetName = 'Scenes')][switch]$InstallHaScenes,
    [Parameter(Mandatory, ParameterSetName = 'Mode')][ValidateSet('movie', 'music', 'off')][string]$Mode,
    [Parameter(Mandatory, ParameterSetName = 'Notify')][switch]$Notify,
    [Parameter(ParameterSetName = 'Notify')][int[]]$Color = @(0, 120, 255),
    [Parameter(ParameterSetName = 'Notify')][int]$DurationMs = 1500
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Amb = Join-Path $Root 'ambilight'
$env:HA_URL = $null
. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1') | Out-Null
. (Join-Path $PSScriptRoot 'lib\hyperhdr.ps1')
. (Join-Path $Amb 'hyperhdr-layout.ps1')

$HyperExe = "$env:ProgramFiles\HyperHDR\bin\hyperhdr.exe"
$OpenRgbExe = "$env:ProgramFiles\OpenRGB\OpenRGB.exe"
$Python = (Get-Command python).Source
$Tasks = @(
    @{ Name = 'vmui-ambilight-hyperhdr'; Exe = $HyperExe;   Args = '--service'; Delay = 5 },
    @{ Name = 'vmui-ambilight-openrgb';  Exe = $OpenRgbExe; Args = '--server --startminimized --profile Dragos'; Delay = 10 },
    @{ Name = 'vmui-ambilight-dxlight';  Exe = $Python;     Args = "`"$Amb\dxlight_bridge.py`" --listen 19446"; Delay = 20 },
    @{ Name = 'vmui-ambilight-pcglow';   Exe = $Python;     Args = "`"$Amb\openrgb_bridge.py`" --listen 19447"; Delay = 25 }
)

function Write-Ok($m) { Write-Host "  $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Write-Step($m) { Write-Host "  $m" -ForegroundColor Cyan }

function Ensure-Instance([string]$Name) {
    $ex = (Get-HyperServerInfo).instance | Where-Object friendly_name -eq $Name
    if (-not $ex) {
        Invoke-Hyper @(@{ command = 'instance'; subcommand = 'createInstance'; name = $Name }) | Out-Null
        Start-Sleep 2
        $ex = (Get-HyperServerInfo).instance | Where-Object friendly_name -eq $Name
    }
    if (-not $ex.running) {
        Invoke-Hyper @(@{ command = 'instance'; subcommand = 'startInstance'; instance = [int]$ex.instance }) | Out-Null
        Start-Sleep 3
    }
    [int]$ex.instance
}

function Enable-Grabber([int]$Instance) {
    Invoke-Hyper @(
        @{ command = 'componentstate'; componentstate = @{ component = 'SYSTEMGRABBER'; state = $true } },
        @{ command = 'componentstate'; componentstate = @{ component = 'VIDEOGRABBER'; state = $false } },
        @{ command = 'componentstate'; componentstate = @{ component = 'LEDDEVICE'; state = $true } }
    ) -Instance $Instance | Out-Null
}

function Configure-HyperHdr {
    Write-Step 'instance 0: DX Light on the movie monitor (right 17, top 31, left 17)'
    Set-HyperConfig -Instance 0 -Config @{
        general       = @{ name = 'DX Light (monitor)'; disableOnLocked = $true; disableLedsStartup = $false; showOptHelp = $false; version = 6 }
        systemGrabber = @{
            device = 'auto'; hardware = $true; fps = 60; videoMode = 512
            # Windows HDR capture returns scRGB floats; without tone-mapping
            # every colour is washed out. 250 nits matches the Odyssey OLED.
            hdrToneMapping = $true; monitor_nits = 250
            cropTop = 0; cropBottom = 0; cropLeft = 0; cropRight = 0
            signalDetection = $false; reorder_displays = 0
            redSignalThreshold = 5; greenSignalThreshold = 5; blueSignalThreshold = 5; noSignalCounterThreshold = 200
            sDHOffsetMin = 0.25; sDHOffsetMax = 0.75; sDVOffsetMin = 0.25; sDVOffsetMax = 0.75
        }
        videoGrabber  = @{ enable = $false }
        device        = @{ type = 'udpraw'; host = '127.0.0.1'; port = 19446; colorOrder = 'rgb'; refreshTime = 0; hardwareLedCount = 65 }
        leds          = New-BorderLayout -Order right, top, left -Counts @{ right = 17; top = 31; left = 17 } -Depth 0.08
        smoothing     = @{ enable = $true; type = 'HybridRgbInterpolator'; time_ms = 60; updateFrequency = 60; antiFlickeringFilter = $true; continuousOutput = $false; damping = 26; stiffness = 150; smoothingFactor = 0; y_limit = 0.03 }
        soundEffect   = @{ device = 'Voicemeeter Out B1 (VB-Audio Vo'; enable = $true; enable_smoothing = $true }
        mqtt          = @{ enable = $true; host = ($env:HA_URL -replace '^https?://', ''); port = 1883; username = $env:MQTT_HYPERHDR_USER; password = $env:MQTT_HYPERHDR_PASS; is_ssl = $false; ignore_ssl_errors = $true; custom_topic = 'HyperHDR'; disableApiAccess = $false; maxRetry = 120 }
    }
    Enable-Grabber 0

    Write-Step 'instance 1: PC glow under the desk (left / whole / right regions)'
    $pc = Ensure-Instance 'PC glow (OpenRGB)'
    Set-HyperConfig -Instance $pc -Config @{
        device    = @{ type = 'udpraw'; host = '127.0.0.1'; port = 19447; colorOrder = 'rgb'; refreshTime = 0; hardwareLedCount = 3 }
        leds      = @() + (New-RegionLayout left) + (New-RegionLayout full) + (New-RegionLayout right)
        smoothing = @{ enable = $true; type = 'HybridRgbInterpolator'; time_ms = 250; updateFrequency = 25; antiFlickeringFilter = $true; continuousOutput = $false; damping = 26; stiffness = 150; smoothingFactor = 0; y_limit = 0.03 }
    }
    Enable-Grabber $pc

    Write-Step 'instance 2: room lights through Home Assistant'
    $ha = Ensure-Instance 'Room lights (Home Assistant)'
    # Order of lamps == order of leds. Add bulbs here once they are in HA:
    #   @{ name = 'light.moodlight'; colorModel = 1 }      -> New-RegionLayout left
    #   @{ name = 'light.ambient_light'; colorModel = 1 }  -> New-RegionLayout right
    $lamps = @(
        @{ name = 'light.desk_light_bar'; colorModel = 1 },
        @{ name = 'light.led_argb';       colorModel = 0 }
    )
    Set-HyperConfig -Instance $ha -Config @{
        device    = @{
            type = 'home_assistant'
            # HyperHDR assumes :8123; this appliance serves on :80.
            homeAssistantHost = (($env:HA_URL -replace '^https?://', '') + ':80')
            longLivedAccessToken = $env:HA_TOKEN
            transition = 300; constantBrightness = 200; restoreOriginalState = $true; maxRetry = 60
            lamps = $lamps; hardwareLedCount = $lamps.Count; colorOrder = 'rgb'; refreshTime = 0
        }
        leds      = @() + (New-RegionLayout top) + (New-RegionLayout full)
        smoothing = @{ enable = $true; type = 'HybridRgbInterpolator'; time_ms = 800; updateFrequency = 3; antiFlickeringFilter = $true; continuousOutput = $false; damping = 26; stiffness = 150; smoothingFactor = 0; y_limit = 0.03 }
    }
    Enable-Grabber $ha
    Write-Ok 'HyperHDR configured'
}

function Install-Tasks {
    foreach ($t in $Tasks) {
        if (-not (Test-Path $t.Exe)) { throw "$($t.Exe) not found" }
        $action = New-ScheduledTaskAction -Execute $t.Exe -Argument $t.Args -WorkingDirectory $Amb
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $trigger.Delay = "PT$($t.Delay)S"
        $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -Hidden
        Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger -Settings $settings `
            -Description 'vmui ambilight stack (scripts/ambilight.ps1)' | Out-Null
        Write-Ok "task $($t.Name)"
    }
    # DX Light and HyperHDR both open the HID device; the last writer wins
    # and the strip flickers. HyperHDR replaces it.
    $run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (Get-ItemProperty $run -Name 'electron.app.DX Light' -ErrorAction SilentlyContinue) {
        Remove-ItemProperty $run -Name 'electron.app.DX Light'
        Write-Ok 'DX Light removed from autostart (app stays installed)'
    }
    Get-Process 'DX Light' -ErrorAction SilentlyContinue | Stop-Process -Force
    # Start whatever is not already running.
    foreach ($t in $Tasks) {
        $proc = Split-Path $t.Exe -Leaf
        $running = Get-CimInstance Win32_Process -Filter "Name='$proc'" | Where-Object { $t.Args -notmatch 'listen' -or $_.CommandLine -match [regex]::Escape(($t.Args -split ' ')[-1]) }
        if (-not $running) { Start-ScheduledTask -TaskName $t.Name; Start-Sleep 2 }
    }
}

function Uninstall-Tasks {
    foreach ($t in $Tasks) { Unregister-ScheduledTask -TaskName $t.Name -Confirm:$false -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'dxlight_bridge|openrgb_bridge' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Ok 'tasks removed; HyperHDR/OpenRGB left installed'
}

function Install-HaScenes {
    $HostSsh = "root@$($env:HA_URL -replace '^https?://','')"
    Get-Content -Raw (Join-Path $Amb 'ha-scenes.yaml') | ssh -o BatchMode=yes -p 22222 $HostSsh 'C=/mnt/data/supervisor/homeassistant; mkdir -p $C/packages && cat > $C/packages/ambilight.yaml && (grep -q "packages:" $C/configuration.yaml || printf "\nhomeassistant:\n  packages: !include_dir_named packages\n" >> $C/configuration.yaml)'
    . (Join-Path $PSScriptRoot 'lib\ha-ws.ps1')
    Invoke-HaRest -Path '/api/services/script/reload' -Method POST -Body @{} | Out-Null
    Invoke-HaRest -Path '/api/services/automation/reload' -Method POST -Body @{} | Out-Null
    Write-Ok 'ha-scenes.yaml installed as package + scripts/automations reloaded'
}

function Set-Mode([string]$m) {
    . (Join-Path $PSScriptRoot 'lib\ha-ws.ps1')
    $script = switch ($m) { 'movie' { 'movie_mode_on' } 'music' { 'music_mode' } default { 'movie_mode_off' } }
    Invoke-HaRest -Path "/api/services/script/$script" -Method POST -Body @{} | Out-Null
    Write-Ok "mode: $m"
}

function Send-Notify {
    . (Join-Path $PSScriptRoot 'lib\ha-ws.ps1')
    Invoke-HaRest -Path '/api/services/script/notify_flash' -Method POST -Body @{ color = $Color; duration_ms = $DurationMs } | Out-Null
    Write-Ok "flash $($Color -join ',') for ${DurationMs}ms"
}

function Show-Status {
    Write-Host ''
    foreach ($t in $Tasks) {
        $st = (Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue).State
        $proc = Split-Path $t.Exe -Leaf
        $live = Get-CimInstance Win32_Process -Filter "Name='$proc'" | Where-Object { $t.Args -notmatch 'listen' -or $_.CommandLine -match [regex]::Escape(($t.Args -split ' ')[-1]) }
        Write-Host ("  {0,-28} task={1,-9} process={2}" -f $t.Name, ($st ?? 'absent'), $(if ($live) { 'running' } else { 'NOT running' })) -ForegroundColor $(if ($live) { 'Green' } else { 'Yellow' })
    }
    Write-Host ''
    try {
        $si = Get-HyperServerInfo
        foreach ($i in $si.instance) {
            $p = (Invoke-Hyper @(@{ command = 'serverinfo' }) -Instance ([int]$i.instance)).info.priorities
            Write-Host ("  [{0}] {1,-30} {2}" -f $i.instance, $i.friendly_name, (($p | ForEach-Object { "$($_.componentId)@$($_.priority)" }) -join ' '))
        }
        $snd = $si.sound
        Write-Host ("  audio: {0} ({1})" -f $snd.device, $(if ($snd.active) { 'active' } else { 'inactive' }))
    }
    catch { Write-Warn "HyperHDR not reachable: $_" }
    $dx = Get-Process 'DX Light' -ErrorAction SilentlyContinue
    if ($dx) { Write-Warn 'DX Light app is running and will fight HyperHDR for the strip' }
    Write-Host ''
}

switch ($PSCmdlet.ParameterSetName) {
    'Install' { Install-Tasks; Configure-HyperHdr; Show-Status }
    'Uninstall' { Uninstall-Tasks }
    'Configure' { Configure-HyperHdr }
    'Scenes' { Install-HaScenes }
    'Mode' { Set-Mode $Mode }
    'Notify' { Send-Notify }
    default { Show-Status }
}
