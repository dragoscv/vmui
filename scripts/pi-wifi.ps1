<#
.SYNOPSIS
  Add the home WiFi as a fallback connection on homepi (Ethernet stays primary).
  Reads HOME_WIFI_SSID / HOME_WIFI_PASS from .private/credentials.env; never echoes them.
#>
param([string] $Pi = 'dragos@192.168.100.230')
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Get-Content (Join-Path $root '.private\credentials.env') | ForEach-Object {
  if ($_ -match '^(HOME_WIFI_SSID|HOME_WIFI_PASS)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2].Trim('"') }
}
if (-not $env:HOME_WIFI_SSID -or -not $env:HOME_WIFI_PASS) { throw 'HOME_WIFI_SSID / HOME_WIFI_PASS missing in .private/credentials.env' }

# Pass the secret via stdin, not argv (argv is visible in `ps`).
$remote = @'
set -e
read -r SSID; read -r PSK
sudo nmcli con delete home-wifi >/dev/null 2>&1 || true
sudo nmcli con add type wifi ifname wlan0 con-name home-wifi ssid "$SSID" >/dev/null
sudo nmcli con modify home-wifi wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PSK" \
  connection.autoconnect yes connection.autoconnect-priority 0 ipv4.route-metric 600
# Ethernet wins when both are up
ETH=$(nmcli -t -f NAME,DEVICE con show --active | awk -F: '$2=="eth0"{print $1}' | head -1)
[ -n "$ETH" ] && sudo nmcli con modify "$ETH" ipv4.route-metric 100 connection.autoconnect-priority 10
sudo nmcli con up home-wifi >/dev/null
sleep 4
nmcli -t -f DEVICE,STATE,CONNECTION dev | grep -E 'eth0|wlan0'
ip -4 -br a show wlan0
'@ -replace "`r`n", "`n"
$tmp = Join-Path $root '.copilot-tmp\pi\wifi.sh'
[IO.File]::WriteAllText($tmp, $remote, [Text.UTF8Encoding]::new($false))
scp -q -o BatchMode=yes $tmp "${Pi}:/tmp/wifi.sh"
$creds = "$env:HOME_WIFI_SSID`n$env:HOME_WIFI_PASS`n"
$creds | ssh -o BatchMode=yes $Pi 'bash /tmp/wifi.sh; rm -f /tmp/wifi.sh' 2>&1 |
  Where-Object { $_ -notmatch [regex]::Escape($env:HOME_WIFI_PASS) }
