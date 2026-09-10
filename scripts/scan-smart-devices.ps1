#requires -version 7
<#
.SYNOPSIS
  Inventory the smart devices Home Assistant will be able to see.

.DESCRIPTION
  Run this BEFORE onboarding Home Assistant, and again after. It answers the
  question that otherwise costs an evening: "is the device missing because the
  integration is wrong, or because the VM cannot see it at all?"

  Four independent probes, because each finds things the others miss:

    ARP/neighbour table -- everything that has spoken IP recently. Vendor is
      derived from the MAC OUI, which is how you spot a Tuya or Espressif chip
      hiding behind a generic hostname.

    mDNS / Bonjour (_services._dns-sd) -- HomeKit, Chromecast, ESPHome,
      Shelly, Hue, printers. This is the protocol that does NOT survive NAT,
      so a result here proves the External switch was the right call.

    SSDP / UPnP -- older Sonos, Roku, smart TVs, some routers.

    Bluetooth LE -- anything paired or advertising near the host.

  Nothing here is a mutation; it is safe to run at any time.

.EXAMPLE
  scan-smart-devices.ps1
  scan-smart-devices.ps1 -Sweep        # ping the whole /24 first, slower
#>
[CmdletBinding()]
param(
    # Populate the ARP table by touching every host in the subnet first.
    # Without this, only devices that talked recently show up.
    [switch]$Sweep,
    [int]$MdnsSeconds = 6
)
$ErrorActionPreference = 'Continue'

function Head($t) {
    Write-Host ''
    Write-Host "  $t" -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * 72))
}

# MAC OUI prefixes worth naming. Not exhaustive -- these are the vendors whose
# presence changes which Home Assistant integration you reach for.
$Oui = @{
    '00155D' = 'Hyper-V virtual'
    '18FE34' = 'Espressif (ESP8266 / Tuya / Sonoff)'
    '2462AB' = 'Espressif (ESP32)'
    '246F28' = 'Espressif (ESP32)'
    '3C6105' = 'Espressif (ESP32)'
    '4C7525' = 'Espressif'
    '5CCF7F' = 'Espressif (ESP8266)'
    '807D3A' = 'Espressif'
    '8CAAB5' = 'Espressif'
    '98F4AB' = 'Espressif (Shelly / Tuya)'
    'A020A6' = 'Espressif (Shelly)'
    'B4E62D' = 'Espressif'
    'BCDDC2' = 'Espressif'
    'C44F33' = 'Espressif'
    'CC50E3' = 'Espressif'
    'D8BFC0' = 'Espressif'
    'DC4F22' = 'Espressif'
    'E09806' = 'Espressif'
    'ECFABC' = 'Espressif'
    '68C63A' = 'Espressif'
    '10521C' = 'Espressif'
    '001788' = 'Philips Hue bridge'
    'ECB5FA' = 'Philips Hue'
    '00178D' = 'Zigbee (Philips)'
    '5CAAFD' = 'Sonos'
    '347E5C' = 'Sonos'
    '542A1B' = 'Sonos'
    'B8E937' = 'Sonos'
    'F0EF86' = 'Google (Chromecast/Nest)'
    '1CF29A' = 'Google'
    '54600A' = 'Google'
    'D86C63' = 'Google'
    '3C5AB4' = 'Google'
    '44073C' = 'Amazon (Echo)'
    '4C17EB' = 'Amazon'
    '68372F' = 'Amazon'
    'FCA667' = 'Amazon'
    'AC63BE' = 'Amazon (Echo)'
    '50DCE7' = 'Amazon'
    '001A11' = 'Google'
    '7C2EBD' = 'Google'
    'DCA632' = 'Raspberry Pi'
    'B827EB' = 'Raspberry Pi'
    'E45F01' = 'Raspberry Pi'
    '2CCF67' = 'Raspberry Pi'
    'D83ADD' = 'Raspberry Pi'
    '000C29' = 'VMware'
    '001C42' = 'Parallels'
    'C82E47' = 'Tuya'
    '68578D' = 'Tuya / Xiaomi'
    '7C49EB' = 'Xiaomi'
    '04CF8C' = 'Xiaomi'
    '78118C' = 'Xiaomi'
    '286C07' = 'Xiaomi'
    '3480B3' = 'Xiaomi'
    '50EC50' = 'Xiaomi'
    '8CDE52' = 'TP-Link (Kasa/Tapo)'
    '003192' = 'TP-Link'
    '1027F5' = 'TP-Link'
    '5C628B' = 'TP-Link'
    '9C5322' = 'TP-Link'
    'B0BE76' = 'TP-Link'
    'F0A731' = 'TP-Link'
    '005F67' = 'Reolink'
    'EC71DB' = 'Reolink'
    'A4DA22' = 'IKEA (Tradfri)'
    '943469' = 'IKEA'
    '000EC6' = 'ASIX'
    'BCFF4D' = 'Espressif'
}

function Get-Vendor([string]$mac) {
    if (-not $mac) { return '' }
    $k = ($mac -replace '[-:]', '').ToUpper()
    if ($k.Length -lt 6) { return '' }
    $p = $k.Substring(0, 6)
    if ($Oui.ContainsKey($p)) { return $Oui[$p] }
    return ''
}

# ---------------------------------------------------------------- subnet
# The interface that owns the default route is the real LAN. Matching on
# private-range prefixes picked the Hyper-V "vmnet" internal switch first
# (10.10.10.1) and scanned an empty subnet.
$gwIf = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1 -ExpandProperty InterfaceIndex
$lan = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $gwIf -ErrorAction SilentlyContinue |
    Where-Object { $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1

if (-not $lan) { Write-Host '  no LAN interface found' -ForegroundColor Red; exit 1 }
$prefix = ($lan.IPAddress -split '\.')[0..2] -join '.'
Write-Host ''
Write-Host "  host $($lan.IPAddress) on $($lan.InterfaceAlias) -- scanning $prefix.0/24" -ForegroundColor DarkGray

if ($Sweep) {
    Head 'ARP sweep (touching every address in the subnet)'
    Write-Host '  this takes ~30s...' -ForegroundColor DarkGray
    # A parallel ping populates the neighbour table for silent devices. Many
    # IoT devices drop ICMP but still ARP-reply, which is what we actually want.
    1..254 | ForEach-Object -ThrottleLimit 64 -Parallel {
        Test-Connection -TargetName "$using:prefix.$_" -Count 1 -TimeoutSeconds 1 `
            -ErrorAction SilentlyContinue | Out-Null
    }
}

# ---------------------------------------------------------------- neighbours
Head 'IP neighbours (ARP)'
$neigh = Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -like "$prefix.*" -and $_.State -in 'Reachable', 'Stale', 'Permanent', 'Delay', 'Probe' } |
    Where-Object { $_.LinkLayerAddress -and $_.LinkLayerAddress -ne '00-00-00-00-00-00' -and $_.LinkLayerAddress -notlike 'ff-ff-*' } |
    Sort-Object { [version](($_.IPAddress -split '\.') -join '.') }

Write-Host ("  {0,-16} {1,-18} {2,-26} {3}" -f 'address', 'mac', 'vendor (OUI)', 'hostname')
foreach ($n in $neigh) {
    $name = ''
    try { $name = [Net.Dns]::GetHostEntry($n.IPAddress).HostName } catch { $name = '' }
    $v = Get-Vendor $n.LinkLayerAddress
    $colour = if ($v -and $v -ne 'Hyper-V virtual') { 'Green' } else { 'Gray' }
    Write-Host ("  {0,-16} {1,-18} {2,-26} {3}" -f $n.IPAddress, $n.LinkLayerAddress.ToLower(), $v, $name) -ForegroundColor $colour
}
Write-Host ("  {0} neighbour(s)" -f @($neigh).Count) -ForegroundColor DarkGray

# ---------------------------------------------------------------- mDNS
Head "mDNS / Bonjour discovery (${MdnsSeconds}s listen)"
Write-Host '  this is the protocol that does not cross NAT -- results here' -ForegroundColor DarkGray
Write-Host '  prove Home Assistant on an External switch will see these too.' -ForegroundColor DarkGray
Write-Host ''

# Query the service-enumeration meta-record, then whatever answers come back.
# Written against raw UDP because Windows has no built-in mDNS browse tool and
# dns-sd.exe only exists if Bonjour was installed.
$found = [System.Collections.Generic.HashSet[string]]::new()
try {
    $udp = [Net.Sockets.UdpClient]::new()
    $udp.ExclusiveAddressUse = $false
    $udp.Client.SetSocketOption('Socket', 'ReuseAddress', $true)
    $udp.Client.Bind([Net.IPEndPoint]::new([Net.IPAddress]::Parse($lan.IPAddress), 0))
    $udp.JoinMulticastGroup([Net.IPAddress]::Parse('224.0.0.251'))

    function New-MdnsQuery([string]$name) {
        $b = [Collections.Generic.List[byte]]::new()
        $b.AddRange([byte[]](0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00))
        foreach ($label in $name.Split('.')) {
            $b.Add([byte]$label.Length)
            $b.AddRange([Text.Encoding]::ASCII.GetBytes($label))
        }
        $b.Add(0x00)
        $b.AddRange([byte[]](0x00, 0x0C, 0x00, 0x01))   # QTYPE=PTR QCLASS=IN
        return $b.ToArray()
    }

    $ep = [Net.IPEndPoint]::new([Net.IPAddress]::Parse('224.0.0.251'), 5353)
    foreach ($svc in @(
            '_services._dns-sd._udp.local',
            '_hap._tcp.local', '_googlecast._tcp.local', '_esphomelib._tcp.local',
            '_shelly._tcp.local', '_hue._tcp.local', '_printer._tcp.local',
            '_homeassistant._tcp.local', '_matter._tcp.local', '_matterc._udp.local',
            '_miio._udp.local', '_sonos._tcp.local', '_axis-video._tcp.local',
            '_http._tcp.local', '_ipp._tcp.local', '_workstation._tcp.local')) {
        $q = New-MdnsQuery $svc
        $udp.Send($q, $q.Length, $ep) | Out-Null
    }

    $deadline = (Get-Date).AddSeconds($MdnsSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($udp.Available -gt 0) {
            $remote = [Net.IPEndPoint]::new([Net.IPAddress]::Any, 0)
            $data = $udp.Receive([ref]$remote)
            # Pull printable label runs out of the response rather than writing
            # a full DNS parser -- enough to identify what is on the network.
            $s = -join ($data | ForEach-Object { if ($_ -ge 32 -and $_ -lt 127) { [char]$_ } else { '|' } })
            foreach ($m in [regex]::Matches($s, '[A-Za-z0-9][A-Za-z0-9 \-_\.]{2,62}')) {
                $v = $m.Value.Trim()
                if ($v -match '_(tcp|udp)|local$|^_' -or $v.Length -gt 6) {
                    $found.Add("$($remote.Address)`t$v") | Out-Null
                }
            }
        }
        else { Start-Sleep -Milliseconds 120 }
    }
    $udp.Close()
}
catch {
    Write-Host "  mDNS probe failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

if ($found.Count -eq 0) {
    Write-Host '  nothing answered' -ForegroundColor Yellow
}
else {
    $found | Sort-Object | Group-Object { ($_ -split "`t")[0] } | ForEach-Object {
        Write-Host ("  {0}" -f $_.Name) -ForegroundColor Green
        $_.Group | ForEach-Object { ($_ -split "`t")[1] } | Sort-Object -Unique |
            Where-Object { $_ -notmatch '^\|+$' } |
            Select-Object -First 12 | ForEach-Object { Write-Host "      $_" }
    }
}

# ---------------------------------------------------------------- SSDP
Head 'SSDP / UPnP discovery'
try {
    $ssdp = [Net.Sockets.UdpClient]::new()
    $ssdp.Client.ReceiveTimeout = 4000
    $msg = "M-SEARCH * HTTP/1.1`r`nHOST: 239.255.255.250:1900`r`nMAN: `"ssdp:discover`"`r`nMX: 2`r`nST: ssdp:all`r`n`r`n"
    $bytes = [Text.Encoding]::ASCII.GetBytes($msg)
    $target = [Net.IPEndPoint]::new([Net.IPAddress]::Parse('239.255.255.250'), 1900)
    $ssdp.Send($bytes, $bytes.Length, $target) | Out-Null

    $seen = @{}
    $stop = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $stop) {
        try {
            $r = [Net.IPEndPoint]::new([Net.IPAddress]::Any, 0)
            $resp = [Text.Encoding]::ASCII.GetString($ssdp.Receive([ref]$r))
            $server = ([regex]::Match($resp, '(?im)^SERVER:\s*(.+)$')).Groups[1].Value.Trim()
            $loc = ([regex]::Match($resp, '(?im)^LOCATION:\s*(.+)$')).Groups[1].Value.Trim()
            $key = "$($r.Address)"
            if (-not $seen.ContainsKey($key)) {
                $seen[$key] = $true
                Write-Host ("  {0,-16} {1}" -f $r.Address, $server) -ForegroundColor Green
                if ($loc) { Write-Host "                   $loc" -ForegroundColor DarkGray }
            }
        }
        catch { break }
    }
    $ssdp.Close()
    if ($seen.Count -eq 0) { Write-Host '  nothing answered' -ForegroundColor Yellow }
}
catch { Write-Host "  SSDP probe failed: $($_.Exception.Message)" -ForegroundColor Yellow }

# ---------------------------------------------------------------- Bluetooth
Head 'Bluetooth devices known to this host'
$bt = Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -notmatch 'Enumerator|Radio|Adapter|Profile|Service|RFCOMM|Device$' }
if ($bt) {
    foreach ($d in $bt | Sort-Object FriendlyName) {
        Write-Host ("  {0,-10} {1}" -f $d.Status, $d.FriendlyName) `
            -ForegroundColor $(if ($d.Status -eq 'OK') { 'Green' } else { 'Gray' })
    }
    Write-Host ''
    Write-Host '  NOTE: Hyper-V cannot pass a Bluetooth radio into the VM.' -ForegroundColor Yellow
    Write-Host '  For BLE sensors in Home Assistant, use an ESPHome Bluetooth' -ForegroundColor Yellow
    Write-Host '  Proxy (a ~5 EUR ESP32 flashed from the HA web UI). See' -ForegroundColor Yellow
    Write-Host '  docs/home-assistant.md, "Radios: Zigbee, Thread, Bluetooth".' -ForegroundColor Yellow
}
else { Write-Host '  no Bluetooth devices enumerated' -ForegroundColor Yellow }

Write-Host ''
