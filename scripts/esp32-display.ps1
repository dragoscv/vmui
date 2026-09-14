#requires -version 7
<#
.SYNOPSIS
  Build, flash and serve the ideaspark ESP32 OLED "home display" (which is
  also Home Assistant's Bluetooth proxy).

.DESCRIPTION
  Firmware = ESPHome, compiled inside the ESPHome add-on on the appliance
  from esp32/home-display.yaml.tmpl. The ESP renders nothing: vmui composes
  each view as a 1-bit 128x64 BMP at /api/esp/display/<node> and the board
  polls it. Because vmui binds 127.0.0.1 only, this script also publishes a
  plain-HTTP LAN listener (Caddy, :8737, /api/esp/* only) that the ESP can
  reach; the token in ESP_DISPLAY_TOKEN gates it.

  Views rotate every 8 s: clock, weather, activity (what HA did), home
  status, ambilight, shopping list, last vmui actions, system.
  BOOT button: short = next view, double = pause, long = movie mode on/off.
  GPIO2 LED: dark when healthy, blinks on WiFi/API trouble (ESPHome status_led).

.EXAMPLE
  esp32-display.ps1 -Status
  esp32-display.ps1 -Publish            # Caddy LAN route :8737 -> vmui /api/esp
  esp32-display.ps1 -Flash              # compile on appliance, flash over COM
  esp32-display.ps1 -Flash -Ota         # after the first flash: over WiFi
  esp32-display.ps1 -Preview clock      # ASCII render of a view (no hardware)
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')][switch]$Status,
    [Parameter(Mandatory, ParameterSetName = 'Publish')][switch]$Publish,
    [Parameter(Mandatory, ParameterSetName = 'Flash')][switch]$Flash,
    [Parameter(ParameterSetName = 'Flash')][switch]$Ota,
    [Parameter(ParameterSetName = 'Flash')][string]$ComPort,
    [Parameter(Mandatory, ParameterSetName = 'Preview')][string]$Preview,
    [string]$NodeName = 'bluetooth-proxy-1',
    [string]$CredPrefix = 'ESPHOME_BTPROXY1',
    [string]$HostSsh = 'root@192.168.100.232',
    [int]$LanPort = 8737,
    [string]$Refresh = '4s',
    # ideaspark ships two layouts: SDA/SCL on 5/4 or on 21/22. -Status shows
    # which one the running board reports.
    [string]$Sda = 'GPIO21',
    [string]$Scl = 'GPIO22'
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$env:HA_URL = $null
. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1') | Out-Null

function Write-Ok($m) { Write-Host "  $m" -ForegroundColor Green }
function Write-Step($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Write-Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }

function Get-LanIp {
    (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.100.*' } | Select-Object -First 1).IPAddress
}

function Get-Token {
    $t = $env:ESP_DISPLAY_TOKEN
    if (-not $t) {
        $t = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
        Add-Content (Join-Path $Root '.private\credentials.env') "`n# ESP32 home display (scripts/esp32-display.ps1)`nESP_DISPLAY_TOKEN=$t"
        $env:ESP_DISPLAY_TOKEN = $t
        Write-Ok 'generated ESP_DISPLAY_TOKEN -> .private'
    }
    $t
}

function Render-Yaml {
    $ip = Get-LanIp
    if (-not $ip) { throw 'no 192.168.100.x address on this PC' }
    $keyVar = "${CredPrefix}_API_KEY"
    $otaVar = "${CredPrefix}_OTA_PASS"
    foreach ($v in 'HOME_WIFI_SSID', 'HOME_WIFI_PASS', $keyVar, $otaVar) {
        if (-not (Get-Item "env:$v" -ErrorAction SilentlyContinue).Value) { throw "$v missing from .private\credentials.env" }
    }
    $tok = Get-Token
    $vars = @{
        node       = $NodeName
        friendly   = (($NodeName -replace '-', ' ') -replace '\b(\w)', { $_.Value.ToUpper() })
        api_key    = (Get-Item "env:$keyVar").Value
        ota_pass   = (Get-Item "env:$otaVar").Value
        wifi_ssid  = $env:HOME_WIFI_SSID
        wifi_pass  = $env:HOME_WIFI_PASS
        refresh    = $Refresh
        sda        = $Sda
        scl        = $Scl
        frame_url  = "http://${ip}:$LanPort/api/esp/display/${NodeName}?k=$tok"
        button_url = "http://${ip}:$LanPort/api/esp/button?k=$tok"
    }
    $y = Get-Content (Join-Path $Root 'esp32\home-display.yaml.tmpl') -Raw
    foreach ($k in $vars.Keys) { $y = $y.Replace('${' + $k + '}', [string]$vars[$k]) }
    if ($y -match '\$\{[a-z_]+\}') { throw "unfilled template variable: $($Matches[0])" }
    $y -replace "`r`n", "`n"
}

function Publish-Lan {
    # Reuse whichever Caddy owns :443 (see publish-vmui.ps1); add a plain-HTTP
    # server on the LAN IP for the ESP. Only /api/esp/* is proxied.
    $ip = Get-LanIp
    $admin = $null
    foreach ($port in 22019, 2019) {
        try { $cfg = Invoke-RestMethod "http://127.0.0.1:$port/config/" -TimeoutSec 3; if ($cfg.apps.http.servers) { $admin = @{ port = $port; cfg = $cfg }; break } } catch {}
    }
    if (-not $admin) { throw 'no Caddy admin API on 22019/2019; run publish-vmui.ps1 first' }
    $base = "http://127.0.0.1:$($admin.port)"
    $srv = @{
        listen = @("${ip}:$LanPort")
        routes = @(
            @{ '@id' = 'vmui-esp'; match = @(@{ path = @('/api/esp/*') }); terminal = $true
               handle = @(@{ handler = 'reverse_proxy'; upstreams = @(@{ dial = '127.0.0.1:3737' }) }) },
            @{ handle = @(@{ handler = 'static_response'; status_code = 404; body = 'esp only' }) }
        )
        automatic_https = @{ disable = $true }
    }
    $json = $srv | ConvertTo-Json -Depth 12 -Compress
    # Caddy answers 200 `null` for an absent key, so test the value, not the status.
    $exists = $false
    try { $exists = $null -ne (Invoke-RestMethod "$base/config/apps/http/servers/vmui_esp" -TimeoutSec 3) } catch {}
    $m = if ($exists) { 'PATCH' } else { 'PUT' }
    Invoke-RestMethod -Method $m "$base/config/apps/http/servers/vmui_esp" -ContentType 'application/json' -Body $json | Out-Null
    Write-Ok "caddy: http://${ip}:$LanPort/api/esp/* -> vmui"
    # Windows Firewall: the vEthernet switch is a private network; Caddy is
    # already allowed for :443 (brivio). Check, don't assume.
    $t = Test-NetConnection -ComputerName $ip -Port $LanPort -WarningAction SilentlyContinue
    if ($t.TcpTestSucceeded) { Write-Ok "port $LanPort reachable on $ip" } else { Write-Warn "port $LanPort NOT reachable on $ip — firewall rule for caddy.exe needed (elevated)" }
}

function Flash-Board {
    $yaml = Render-Yaml
    Write-Step 'writing config into the ESPHome add-on and compiling (2-6 min)...'
    $yaml | ssh -o BatchMode=yes -p 22222 $HostSsh "mkdir -p /mnt/data/supervisor/homeassistant/esphome && cat > /mnt/data/supervisor/homeassistant/esphome/$NodeName.yaml"
    $out = ssh -o BatchMode=yes -p 22222 $HostSsh "docker exec -w /config/esphome app_5c53de3b_esphome esphome compile $NodeName.yaml 2>&1 | tail -5"
    $out | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    if (-not (($out -join "`n") -match 'Successfully compiled')) { throw 'compile did not report success; see ESPHome add-on logs' }
    if ($Ota) {
        Write-Step 'OTA upload from the appliance...'
        ssh -o BatchMode=yes -p 22222 $HostSsh "docker exec -w /config/esphome app_5c53de3b_esphome esphome upload --device $NodeName.local $NodeName.yaml 2>&1 | tail -3" | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Write-Ok 'OTA done; the board reboots'
        return
    }
    if (-not $ComPort) {
        $c = Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\(COM\d+\)' -and $_.HardwareID -match 'VID_1A86&PID_7523|VID_10C4' } | Select-Object -First 1
        if (-not $c) { throw 'no CH340 serial device found; pass -ComPort' }
        $ComPort = [regex]::Match($c.Name, 'COM\d+').Value
    }
    Write-Step 'pulling firmware.factory.bin...'
    $tmp = Join-Path $Root ".copilot-tmp\$NodeName.factory.bin"
    New-Item -ItemType Directory -Force (Split-Path $tmp) | Out-Null
    $b64 = ssh -o BatchMode=yes -p 22222 $HostSsh "base64 -w0 /mnt/data/supervisor/homeassistant/esphome/.esphome/build/$NodeName/build/firmware.factory.bin"
    [IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String($b64))
    Write-Ok "$((Get-Item $tmp).Length) bytes"
    Write-Step "flashing $ComPort..."
    $flash = python -m esptool --port $ComPort --baud 460800 --chip esp32 write_flash 0x0 $tmp 2>&1
    $flash | Select-String -Pattern 'Wrote|verified|rror' | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    if (($flash -join "`n") -notmatch 'Hash of data verified') { throw "esptool did not verify the write on $ComPort (port busy? board mid-reset?) — retry" }
    Write-Ok 'flashed; the display shows the offline clock until it fetches the first frame (~20 s)'
}

function Show-Status {
    $ip = Get-LanIp
    $tok = $env:ESP_DISPLAY_TOKEN
    $url = "http://${ip}:$LanPort/api/esp/display/${NodeName}?k=$tok"
    $r = curl.exe -s -o NUL -w '%{http_code} %{size_download}B %{content_type}' $url --max-time 6
    Write-Host "  frame url  $($url -replace '\?k=.*', '?k=***')"
    Write-Host "  frame      $r $(if ($r -match '^200 1086B') { '(OK: 128x64 1-bit BMP)' } else { '<- expected 200 1086B image/bmp' })"
    $p = Test-Connection "$NodeName.local" -Count 1 -Quiet -ErrorAction SilentlyContinue
    Write-Host "  board      $NodeName.local $(if ($p) { 'answers ping' } else { 'no ping (mDNS?)' })"
    try {
        $h = @{ Authorization = "Bearer $env:HA_TOKEN" }
        # HA prefixes entity ids with the device's area ("office_…"), so match by suffix.
        $slug = $NodeName -replace '-', '_'
        $all = Invoke-RestMethod "$($env:HA_URL.TrimEnd('/'))/api/states" -Headers $h
        foreach ($suffix in 'wifi_signal', 'heap_free', 'loop_time', 'uptime', 'ip') {
            $s = $all | Where-Object { $_.entity_id -match "^sensor\..*${slug}_${suffix}$" } | Select-Object -First 1
            if ($s) { Write-Host ("  {0,-10} {1} {2}" -f $suffix, $s.state, $s.attributes.unit_of_measurement) }
        }
    } catch { Write-Host '  ha         unreachable' }
}

function Show-Preview([string]$view) {
    $script = @"
import { renderView } from './src/lib/esp/views';
import { ha } from './src/lib/home/ha-client';
const all = await ha.states().catch(() => []);
const fb = await renderView('$view' as any, { states: new Map(all.map((s: any) => [s.entity_id, s])), now: new Date(), node: '$NodeName', paused: false, ambilightMode: 'movie' });
console.log(fb.toAscii());
"@
    $tmp = Join-Path $Root '.copilot-tmp\esp-preview.mts'
    Set-Content $tmp $script -Encoding utf8
    Push-Location $Root
    try { pnpm exec tsx --tsconfig tsconfig.json $tmp } finally { Pop-Location }
}

switch ($PSCmdlet.ParameterSetName) {
    'Publish' { Publish-Lan; Show-Status }
    'Flash' { Flash-Board }
    'Preview' { Show-Preview $Preview }
    default { Show-Status }
}
