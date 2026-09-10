#requires -version 7
<#
.SYNOPSIS
  Expose a USB Zigbee coordinator plugged into the Windows host to the
  Home Assistant VM over TCP.

.DESCRIPTION
  Hyper-V Generation 2 guests have no USB passthrough, so a Zigbee stick in the
  host is invisible to Home Assistant OS. The standard way round it is a
  serial-over-TCP bridge: the host owns the COM port and Zigbee2MQTT connects
  to `tcp://<host>:<port>` exactly as it would to an Ethernet coordinator.

  This script runs that bridge with `com2tcp`-free, dependency-free
  PowerShell: a raw TCP listener that shovels bytes between the COM port and
  one client at a time. It is installed as a Windows service via NSSM-less
  Scheduled Task so it survives reboots and runs without a logged-in user.

  Long-term the better answer is a NETWORK coordinator (SMLIGHT SLZB-06 or
  SLZB-06M, ~30 EUR, PoE). It plugs into the router, publishes itself over
  mDNS, and Zigbee2MQTT finds it with `port: mdns://slzb-06`. No host process,
  no bridge, no USB. This script exists for the interim and for radios that
  only ship as USB (Thread/Matter RCPs).

.EXAMPLE
  zigbee-bridge.ps1 -List                         # which COM port is the stick?
  zigbee-bridge.ps1 -Install -ComPort COM5        # bridge + autostart
  zigbee-bridge.ps1 -Status
  zigbee-bridge.ps1 -Uninstall
  zigbee-bridge.ps1 -Run -ComPort COM5            # foreground, for debugging
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')][switch]$Status,
    [Parameter(Mandatory, ParameterSetName = 'List')][switch]$List,
    [Parameter(Mandatory, ParameterSetName = 'Install')][switch]$Install,
    [Parameter(Mandatory, ParameterSetName = 'Uninstall')][switch]$Uninstall,
    [Parameter(Mandatory, ParameterSetName = 'Run')][switch]$Run,

    [Parameter(ParameterSetName = 'Install')]
    [Parameter(ParameterSetName = 'Run')]
    [string]$ComPort,
    # 115200 for Z-Stack (CC2652, Sonoff ZBDongle-P) and EZSP (SkyConnect/ZBT-1,
    # ZBDongle-E); 38400 for deCONZ/ConBee.
    [int]$Baud = 115200,
    # Zigbee2MQTT's conventional serial-over-TCP port.
    [int]$Port = 6638,
    # Only the appliance may connect. Anything on the LAN with this port open
    # could otherwise reset the coordinator.
    [string]$AllowFrom = '192.168.100.232'
)
$ErrorActionPreference = 'Stop'
$TaskName = 'vmui-zigbee-bridge'

function Write-Ok($m) { Write-Host "  $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Write-Fail($m) { Write-Host "  $m" -ForegroundColor Red }

function Get-ZigbeePorts {
    # Match on the USB vendor/product strings Zigbee coordinators actually
    # use; a bare COM list includes motherboard UARTs and Bluetooth SPP.
    Get-CimInstance Win32_PnPEntity |
        Where-Object { $_.Name -match '\(COM\d+\)' } |
        ForEach-Object {
            $com = [regex]::Match($_.Name, 'COM\d+').Value
            $hint = switch -Regex ($_.Name + ' ' + $_.DeviceID) {
                'VID_10C4&PID_EA60' { 'CP2102 (Sonoff ZBDongle-P / SkyConnect / ZBT-1)' }
                'VID_1A86&PID_55D4' { 'CH9102 (Sonoff ZBDongle-E)' }
                'VID_1A86&PID_7523' { 'CH340 (generic CC2652 boards)' }
                'VID_0403'          { 'FTDI' }
                'VID_1CF1'          { 'dresden elektronik ConBee' }
                'VID_0451'          { 'Texas Instruments (CC2531 launchpad)' }
                default             { '' }
            }
            [pscustomobject]@{ Port = $com; Name = $_.Name; Hint = $hint }
        } | Sort-Object Port
}

function Start-Bridge {
    param([string]$Com, [int]$BaudRate, [int]$TcpPort, [string]$Allow)

    $serial = [IO.Ports.SerialPort]::new($Com, $BaudRate, 'None', 8, 'One')
    $serial.ReadTimeout = 50
    $serial.WriteTimeout = 1000
    $serial.DtrEnable = $true
    $serial.RtsEnable = $true
    $serial.Open()
    Write-Ok "$Com open at $BaudRate"

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, $TcpPort)
    $listener.Start()
    Write-Ok "listening on tcp://0.0.0.0:$TcpPort (allow $Allow)"

    $buf = [byte[]]::new(4096)
    while ($true) {
        $client = $listener.AcceptTcpClient()
        $remote = ([Net.IPEndPoint]$client.Client.RemoteEndPoint).Address.ToString()
        if ($Allow -and $remote -ne $Allow) {
            Write-Warn "refused $remote"
            $client.Close()
            continue
        }
        Write-Ok "client $remote connected"
        $client.NoDelay = $true
        $net = $client.GetStream()
        $net.ReadTimeout = 50
        try {
            while ($client.Connected) {
                # serial -> tcp
                $n = 0
                try { $n = $serial.Read($buf, 0, $buf.Length) } catch [TimeoutException] { }
                if ($n -gt 0) { $net.Write($buf, 0, $n) }
                # tcp -> serial
                if ($net.DataAvailable) {
                    $m = $net.Read($buf, 0, $buf.Length)
                    if ($m -le 0) { break }
                    $serial.Write($buf, 0, $m)
                }
                elseif ($n -eq 0) {
                    # Poll-based, not event-based: a 2 ms idle keeps CPU near
                    # zero and adds no latency Zigbee would notice (Zigbee
                    # itself works in 15 ms slots).
                    Start-Sleep -Milliseconds 2
                    # Detect a half-closed socket.
                    if ($client.Client.Poll(0, 'SelectRead') -and $client.Client.Available -eq 0) { break }
                }
            }
        }
        catch { Write-Warn "client error: $($_.Exception.Message)" }
        finally {
            $client.Close()
            Write-Warn "client $remote disconnected"
        }
    }
}

switch ($PSCmdlet.ParameterSetName) {
    'List' {
        Write-Host ''
        $ports = Get-ZigbeePorts
        if (-not $ports) { Write-Warn 'no COM ports enumerated'; break }
        foreach ($p in $ports) {
            $c = if ($p.Hint) { 'Green' } else { 'Gray' }
            Write-Host ("  {0,-6} {1,-50} {2}" -f $p.Port, $p.Name, $p.Hint) -ForegroundColor $c
        }
        Write-Host ''
        Write-Host '  Green rows are known Zigbee/Thread USB bridges.' -ForegroundColor DarkGray
    }

    'Run' {
        if (-not $ComPort) { Write-Fail 'pass -ComPort (see -List)'; exit 1 }
        Start-Bridge -Com $ComPort -BaudRate $Baud -TcpPort $Port -Allow $AllowFrom
    }

    'Install' {
        if (-not $ComPort) { Write-Fail 'pass -ComPort (see -List)'; exit 1 }
        $pwsh = (Get-Command pwsh).Source
        $args = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Run -ComPort $ComPort -Baud $Baud -Port $Port -AllowFrom $AllowFrom"
        $action = New-ScheduledTaskAction -Execute $pwsh -Argument $args
        $trigger = New-ScheduledTaskTrigger -AtStartup
        # Restart forever: the stick re-enumerates after sleep/resume and the
        # bridge must come back with it.
        $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
            -Settings $settings -Principal $principal -Description 'vmui: Zigbee USB coordinator over TCP for the Home Assistant VM' | Out-Null
        Start-ScheduledTask -TaskName $TaskName

        # Windows Firewall: only the appliance.
        Remove-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName $TaskName -Direction Inbound -Action Allow -Protocol TCP `
            -LocalPort $Port -RemoteAddress $AllowFrom -Profile Private | Out-Null

        Write-Ok "installed task '$TaskName' ($ComPort @ $Baud -> tcp:$Port, allow $AllowFrom)"
        Write-Host ''
        Write-Host '  Zigbee2MQTT add-on configuration (Settings -> Add-ons -> Zigbee2MQTT):' -ForegroundColor Cyan
        $hostIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex (
                Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1).InterfaceIndex |
            Where-Object PrefixOrigin -ne 'WellKnown' | Select-Object -First 1).IPAddress
        Write-Host "    serial:" -ForegroundColor DarkGray
        Write-Host "      port: tcp://${hostIp}:$Port" -ForegroundColor DarkGray
        Write-Host "      adapter: zstack     # or ember for SkyConnect/ZBT-1/ZBDongle-E" -ForegroundColor DarkGray
        Write-Host "      baudrate: $Baud" -ForegroundColor DarkGray
    }

    'Uninstall' {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Remove-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue
        Write-Ok 'removed'
    }

    default {
        Write-Host ''
        $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if (-not $t) { Write-Warn "bridge not installed. Run: zigbee-bridge.ps1 -List, then -Install -ComPort COMx"; break }
        $i = Get-ScheduledTaskInfo -TaskName $TaskName
        Write-Host ("  {0,-12} {1}" -f 'task', $t.State)
        Write-Host ("  {0,-12} {1}" -f 'last run', $i.LastRunTime)
        Write-Host ("  {0,-12} {1}" -f 'last result', $i.LastTaskResult)
        $l = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        Write-Host ("  {0,-12} {1}" -f "tcp:$Port", $(if ($l) { 'listening' } else { 'NOT listening' })) `
            -ForegroundColor $(if ($l) { 'Green' } else { 'Red' })
        Write-Host ''
    }
}
