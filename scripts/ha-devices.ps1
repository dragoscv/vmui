#requires -version 7
<#
.SYNOPSIS
  Discover the smart devices on the LAN / over BLE and wire them into Home
  Assistant: complete pending discovery flows, add cloud integrations, build
  and flash the ESPHome Bluetooth proxy, register BLE LED controllers.

.DESCRIPTION
  What each integration actually needs, measured on 2026-09-12:

    Google Cast, Matter, Thread      auto -- zero interaction
    DLNA, Samsung TV, MQTT, ESPHome  discovered; one "confirm" step (ESPHome
                                     also wants the noise PSK)
    Android TV Remote                discovered; needs a PIN shown ON THE TV
    Tuya (Smart Life)                cloud; user_code, then a QR the phone scans
    ConnectLife (Hisense AC)         cloud; email + password (HACS custom)
    elkbledom (MELK/ELK BLE LEDs)    HACS custom; manual mac + model, then a
                                     flicker test over the Bluetooth proxy

  The Hyper-V appliance has no radio of its own, so BLE goes through an
  ESPHome Bluetooth Proxy (an ESP32). -FlashProxy compiles the firmware
  INSIDE the ESPHome add-on and flashes it from THIS host over the ESP32's
  COM port -- the only place the USB device is visible.

.EXAMPLE
  ha-devices.ps1 -Inventory            # LAN + BLE + pending flows
  ha-devices.ps1 -FlashProxy -ComPort COM10
  ha-devices.ps1 -ConfirmDiscovered    # DLNA / Samsung / MQTT / ESPHome
  ha-devices.ps1 -AddTuya              # prints the QR path; scan, re-run to finish
  ha-devices.ps1 -AddConnectLife
  ha-devices.ps1 -AddBleLed -Mac BE:69:83:00:C4:0B -Name 'LED ARGB' -Model MELK-OA10
  ha-devices.ps1 -PairAndroidTv -Name 'Kitchen TV' -Pin 123456
#>
[CmdletBinding(DefaultParameterSetName = 'Inventory')]
param(
    [Parameter(ParameterSetName = 'Inventory')][switch]$Inventory,
    [Parameter(Mandatory, ParameterSetName = 'Proxy')][switch]$FlashProxy,
    [Parameter(ParameterSetName = 'Proxy')][string]$ComPort,
    [Parameter(ParameterSetName = 'Proxy')][string]$NodeName = 'bluetooth-proxy-1',
    [Parameter(Mandatory, ParameterSetName = 'Confirm')][switch]$ConfirmDiscovered,
    [Parameter(Mandatory, ParameterSetName = 'Tuya')][switch]$AddTuya,
    [Parameter(Mandatory, ParameterSetName = 'CL')][switch]$AddConnectLife,
    [Parameter(Mandatory, ParameterSetName = 'Led')][switch]$AddBleLed,
    [Parameter(Mandatory, ParameterSetName = 'Led')][string]$Mac,
    [Parameter(Mandatory, ParameterSetName = 'Led')][string]$Name,
    [Parameter(ParameterSetName = 'Led')][string]$Model = 'MELK-OA10',
    [Parameter(Mandatory, ParameterSetName = 'Atv')][switch]$PairAndroidTv,
    [Parameter(Mandatory, ParameterSetName = 'Atv')][string]$TvName,
    [Parameter(ParameterSetName = 'Atv')][string]$Pin,
    [Parameter(Mandatory, ParameterSetName = 'Hacs')][switch]$InstallCustomIntegrations
)
$ErrorActionPreference = 'Stop'
$env:HA_URL = $null
. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1') | Out-Null
. (Join-Path $PSScriptRoot 'lib\ha-ws.ps1')

$HostSsh = "root@$($env:HA_URL -replace '^https?://','')"
function Write-Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Write-Ok($m) { Write-Host "  $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Show-Flow($r) {
    Write-Host ("  -> {0} {1} {2}" -f $r.type, $r.step_id, ($r.title ?? $r.reason ?? '')) -ForegroundColor DarkGray
    if ($r.errors -and $r.errors.PSObject.Properties.Count) { Write-Warn ("errors: " + ($r.errors | ConvertTo-Json -Compress)) }
}

function Show-Inventory {
    Write-Host ''
    Write-Host '  pending discovery flows' -ForegroundColor Cyan
    foreach ($f in Get-HaPendingFlows) {
        if (-not $f.handler) { continue }
        Write-Host ("  {0,-20} {1,-30} {2}" -f $f.handler, ($f.context.title_placeholders.name ?? ''), $f.context.source)
    }
    Write-Host ''
    Write-Host '  devices in Home Assistant' -ForegroundColor Cyan
    $entries = Invoke-HaRest '/api/config/config_entries/entry'
    $devs = Invoke-HaWs @{ type = 'config/device_registry/list' }
    foreach ($d in ($devs | Where-Object { $_.manufacturer -and $_.manufacturer -notmatch 'Home Assistant|Official apps|Community' } | Sort-Object manufacturer, name)) {
        $dom = ($entries | Where-Object id -in $d.config_entries | ForEach-Object domain) -join ','
        Write-Host ("  {0,-34} {1,-22} {2,-26} {3}" -f ($d.name_by_user ?? $d.name), $d.manufacturer, $d.model, $dom)
    }
    Write-Host ''
    Write-Host '  BLE devices heard by the proxy (20s)' -ForegroundColor Cyan
    & (Join-Path $PSScriptRoot 'scan-smart-devices.ps1') -BleOnly -BleSeconds 20
}

function Install-CustomIntegrations {
    # HACS itself plus the two custom integrations we depend on. Installed by
    # URL rather than through the HACS UI so a rebuilt appliance comes back
    # identical. The HA container has curl+unzip; the host OS has neither.
    Write-Step 'installing HACS, elkbledom, connectlife into /config/custom_components...'
    $sh = @'
set -e
cd /config && mkdir -p custom_components && cd custom_components
rm -rf hacs elkbledom connectlife
curl -sL -o /tmp/hacs.zip https://github.com/hacs/integration/releases/latest/download/hacs.zip
mkdir hacs && unzip -qo /tmp/hacs.zip -d hacs
curl -sL https://github.com/dave-code-ruiz/elkbledom/archive/refs/heads/main.tar.gz | tar -xz -C /tmp
cp -r /tmp/elkbledom-main/custom_components/elkbledom .
curl -sL https://github.com/oyvindwe/connectlife-ha/archive/refs/heads/main.tar.gz | tar -xz -C /tmp
cp -r /tmp/connectlife-ha-main/custom_components/connectlife .
for d in hacs elkbledom connectlife; do printf '%-12s ' $d; grep -o '"version": "[^"]*"' $d/manifest.json; done
'@ -replace "`r`n", "`n"
    $sh | ssh -o BatchMode=yes -p 22222 $HostSsh 'docker exec -i homeassistant sh'
    Write-Step 'restarting core (custom components load at boot only)...'
    ssh -o BatchMode=yes -p 22222 $HostSsh 'ha core restart' | Out-Null
    Write-Ok 'restarted; allow ~70s before adding integrations'
}

function Flash-Proxy {
    if (-not $ComPort) {
        $c = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\(COM\d+\)' -and $_.HardwareID -match 'VID_1A86|VID_10C4' } | Select-Object -First 1
        if (-not $c) { throw 'no CH340/CP210x serial device found; pass -ComPort' }
        $ComPort = [regex]::Match($c.Name, 'COM\d+').Value
        Write-Ok "using $ComPort ($($c.Name))"
    }
    foreach ($v in 'HOME_WIFI_SSID', 'HOME_WIFI_PASS') { if (-not (Get-Item "env:$v" -EA SilentlyContinue).Value) { throw "$v missing from .private\credentials.env" } }
    $keyVar = "ESPHOME_$($NodeName.ToUpper() -replace '[^A-Z0-9]','')_API_KEY"
    $otaVar = "ESPHOME_$($NodeName.ToUpper() -replace '[^A-Z0-9]','')_OTA_PASS"
    if (-not (Get-Item "env:$keyVar" -EA SilentlyContinue).Value) {
        # Generate once and persist; the same key must be in HA's ESPHome entry.
        $key = [Convert]::ToBase64String((1..32 | ForEach-Object { [byte](Get-Random -Max 256) }))
        $ota = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
        Add-Content -Path (Join-Path $PSScriptRoot '..\.private\credentials.env') -Value "`n# ESPHome $NodeName`n$keyVar=$key`n$otaVar=$ota"
        Set-Item "env:$keyVar" $key; Set-Item "env:$otaVar" $ota
        Write-Ok "generated API key + OTA password -> .private ($keyVar)"
    }
    $yaml = @"
# Bluetooth proxy for Home Assistant. Managed by vmui (scripts/ha-devices.ps1).
# Hyper-V cannot pass the host Bluetooth radio into the appliance, so this
# ESP32 IS Home Assistant's Bluetooth radio. Place it near the BLE devices.
esphome:
  name: $NodeName
  friendly_name: $(($NodeName -replace '-', ' ') -replace '\b(\w)', { $_.Value.ToUpper() })
esp32:
  board: esp32dev
  framework:
    type: esp-idf
logger:
  level: INFO
api:
  encryption:
    key: "$((Get-Item "env:$keyVar").Value)"
ota:
  - platform: esphome
    password: "$((Get-Item "env:$otaVar").Value)"
wifi:
  ssid: "$env:HOME_WIFI_SSID"
  password: "$env:HOME_WIFI_PASS"
  power_save_mode: none
  ap:
    ssid: "$NodeName Fallback"
    password: "$((Get-Item "env:$otaVar").Value)"
captive_portal:
# active: true lets HA CONNECT to BLE devices (control LEDs), not just listen.
esp32_ble_tracker:
  scan_parameters:
    active: true
bluetooth_proxy:
  active: true
button:
  - platform: restart
    name: Restart
"@ -replace "`r`n", "`n"

    Write-Step 'writing config into the ESPHome add-on and compiling (2-6 min)...'
    # No sftp on HAOS; stdin over ssh is the transport.
    $yaml | ssh -o BatchMode=yes -p 22222 $HostSsh "mkdir -p /mnt/data/supervisor/homeassistant/esphome && cat > /mnt/data/supervisor/homeassistant/esphome/$NodeName.yaml"
    ssh -o BatchMode=yes -p 22222 $HostSsh "docker exec -w /config/esphome app_5c53de3b_esphome esphome compile $NodeName.yaml 2>&1 | tail -3"

    Write-Step 'pulling firmware.factory.bin to the host...'
    $tmp = Join-Path $PSScriptRoot "..\.copilot-tmp\$NodeName.factory.bin"
    New-Item -ItemType Directory -Force -Path (Split-Path $tmp) | Out-Null
    $b64 = ssh -o BatchMode=yes -p 22222 $HostSsh "base64 -w0 /mnt/data/supervisor/homeassistant/esphome/.esphome/build/$NodeName/build/firmware.factory.bin"
    [IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String($b64))
    Write-Ok "$((Get-Item $tmp).Length) bytes"

    Write-Step "flashing $ComPort..."
    python -m esptool --port $ComPort --baud 460800 --chip esp32 write_flash 0x0 $tmp 2>&1 |
        Select-String -Pattern 'Wrote|verified|rror' | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Write-Ok "flashed. It joins WiFi in ~20s and HA discovers it; then run -ConfirmDiscovered"
}

function Confirm-Discovered {
    $flows = Get-HaPendingFlows
    foreach ($f in $flows) {
        switch ($f.handler) {
            'esphome' {
                Write-Step "ESPHome $($f.context.title_placeholders.name)"
                $r = Get-HaFlow $f.flow_id
                if ($r.step_id -eq 'discovery_confirm') { $r = Step-HaFlow -FlowId $f.flow_id -Data @{}; Show-Flow $r }
                if ($r.step_id -eq 'encryption_key') {
                    $node = $f.context.title_placeholders.name -replace '.*\((.*)\).*', '$1'
                    $keyVar = "ESPHOME_$($node.ToUpper() -replace '[^A-Z0-9]','')_API_KEY"
                    $r = Step-HaFlow -FlowId $f.flow_id -Data @{ noise_psk = (Get-Item "env:$keyVar").Value }; Show-Flow $r
                }
            }
            'mqtt' { Write-Step 'MQTT'; $r = Step-HaFlow -FlowId $f.flow_id -Data @{}; Show-Flow $r }
            'dlna_dmr' { Write-Step "DLNA $($f.context.title_placeholders.name)"; $r = Step-HaFlow -FlowId $f.flow_id -Data @{}; Show-Flow $r }
            'samsungtv' { Write-Step 'Samsung TV'; $r = Step-HaFlow -FlowId $f.flow_id -Data @{}; Show-Flow $r }
            'androidtv_remote' { Write-Warn "Android TV '$($f.context.title_placeholders.name)' needs a PIN from the TV: -PairAndroidTv -TvName '...' -Pin ..." }
            default { if ($f.handler) { Write-Warn "left alone: $($f.handler) $($f.context.title_placeholders.name)" } }
        }
    }
}

function Add-Tuya {
    $stateFile = Join-Path $PSScriptRoot '..\.copilot-tmp\tuya-flow.txt'
    if (Test-Path $stateFile) {
        # Second run: the phone has scanned; finish.
        $r = Step-HaFlow -FlowId (Get-Content $stateFile -Raw).Trim() -Data @{}
        Show-Flow $r
        if ($r.type -eq 'create_entry') { Remove-Item $stateFile; Write-Ok 'Tuya linked; devices import over the next ~30s' }
        return
    }
    if (-not $env:TUYA_USER_CODE) { throw 'TUYA_USER_CODE missing: Smart Life app -> Me -> Settings -> Account -> User Code' }
    $r = Start-HaFlow -Domain tuya
    $r = Step-HaFlow -FlowId $r.flow_id -Data @{ user_code = $env:TUYA_USER_CODE }
    Show-Flow $r
    if ($r.step_id -ne 'scan') { throw "unexpected step $($r.step_id)" }
    $payload = ($r.data_schema | Where-Object name -eq 'QR').selector.qr_code.data
    $png = Join-Path $PSScriptRoot '..\.copilot-tmp\tuya-qr.png'
    python -c "import qrcode,sys; qrcode.make(sys.argv[1], box_size=12, border=4).save(sys.argv[2])" $payload $png
    $r.flow_id | Set-Content $stateFile
    Write-Ok "QR at $png -- scan it with Smart Life (Me -> scan icon), then re-run -AddTuya"
    Start-Process $png
}

function Add-ConnectLife {
    foreach ($v in 'CONNECTLIFE_USER', 'CONNECTLIFE_PASS') { if (-not (Get-Item "env:$v" -EA SilentlyContinue).Value) { throw "$v missing from .private" } }
    $r = Start-HaFlow -Domain connectlife
    $r = Step-HaFlow -FlowId $r.flow_id -Data @{ username = $env:CONNECTLIFE_USER; password = $env:CONNECTLIFE_PASS; trir = $false; development_mode = $false }
    Show-Flow $r
}

function Add-BleLed {
    # elkbledom exposes a manual step; discovery-by-name is unreliable through
    # a proxy because the MELK advert carries the name only intermittently.
    $r = Start-HaFlow -Domain elkbledom
    $r = Step-HaFlow -FlowId $r.flow_id -Data @{ mac = $Mac.ToUpper(); name = $Name; model = $Model; effects_class = $(if ($Model -like 'MELK-O*') { 'EFFECTS_MELK_Ox' } elseif ($Model -like 'MELK*') { 'EFFECTS_MELK' } else { 'EFFECTS' }) }
    Show-Flow $r
    if ($r.step_id -eq 'validate') { $r = Step-HaFlow -FlowId $r.flow_id -Data @{ flicker = $true }; Show-Flow $r }
}

function Pair-AndroidTv {
    $f = Get-HaPendingFlows | Where-Object { $_.handler -eq 'androidtv_remote' -and $_.context.title_placeholders.name -eq $TvName } | Select-Object -First 1
    if (-not $f) { throw "no pending androidtv_remote flow named '$TvName'" }
    $r = Get-HaFlow $f.flow_id
    if ($r.step_id -ne 'pair') { $r = Step-HaFlow -FlowId $f.flow_id -Data @{}; Show-Flow $r }
    if (-not $Pin) { Write-Warn 'a PIN is now on the TV screen; re-run with -Pin'; return }
    $r = Step-HaFlow -FlowId $f.flow_id -Data @{ pin = $Pin }; Show-Flow $r
}

switch ($PSCmdlet.ParameterSetName) {
    'Proxy' { Flash-Proxy }
    'Confirm' { Confirm-Discovered }
    'Tuya' { Add-Tuya }
    'CL' { Add-ConnectLife }
    'Led' { Add-BleLed }
    'Atv' { Pair-AndroidTv }
    'Hacs' { Install-CustomIntegrations }
    default { Show-Inventory }
}
