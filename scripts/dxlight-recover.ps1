<#
.SYNOPSIS DX Light (Robobloq 1a86:fe07) health + recovery, runnable unelevated.

.DESCRIPTION
  The strip's USB controller wedges after hours: hidapi write() returns -1
  ("HID write failed") forever while Windows still lists the device as OK.
  2026-09-15: pnputil /restart-device on the composite parent made the device
  DISAPPEAR and only a physical replug brought it back -- so this script never
  restarts blindly. It records the state first, then tries the gentlest thing
  that is still known to help, and stops as soon as a probe write succeeds.

  Ladder (each step is followed by a probe write through hidapi):
    1. observe  -- PnP status of all 4 nodes, ConfigManagerErrorCode, hub port,
                   last-arrival time, USB selective suspend state. Always logged.
    2. reopen   -- close/open the HID handle (cheap; catches a stale handle).
    3. disable/enable the HID child (HID\VID_1A86&PID_FE07&MI_00), NOT the
                   composite parent. Needs elevation -> goes through the
                   registered task `vmui-dxlight-recover` when present.
    4. give up  -- print the exact state so the next hand-replug is informed.

    -Register creates the elevated scheduled task (one UAC) so step 3 works from
    the bridge without a prompt, AND disables Windows' idle power-down of the
    strip's USB interface (MSPower_DeviceEnable = False; the "allow the
    computer to turn off this device" box). That box was ON, and a CH55x-class
    controller that is suspended mid-stream is the most plausible wedge.
    -Status prints the observation only.

.EXAMPLE
  scripts\dxlight-recover.ps1 -Status
  scripts\dxlight-recover.ps1            # observe + ladder
  scripts\dxlight-recover.ps1 -Register  # once, elevated
#>
[CmdletBinding()]
param(
    [switch]$Status,
    [switch]$Register,
    # Internal: the elevated task calls back with this to run step 3 only.
    [switch]$DisableEnable
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Python = (Get-Command python -ErrorAction SilentlyContinue).Source ?? 'C:\Python314\python.exe'
$TaskName = 'vmui-dxlight-recover'
$LogDir = Join-Path $Root '.copilot-tmp\service-logs'
New-Item -ItemType Directory -Force $LogDir | Out-Null
$Log = Join-Path $LogDir 'dxlight-recover.log'

function Say([string]$m) { $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; Write-Host $line; Add-Content -Path $Log -Value $line }

function Get-DxNodes {
    Get-PnpDevice | Where-Object { $_.InstanceId -match 'VID_1A86&PID_FE07' } |
        Select-Object Status, Present, InstanceId, @{ n = 'Err'; e = { (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName DEVPKEY_Device_ProblemCode -ErrorAction SilentlyContinue).Data } }
}

function Observe {
    $nodes = Get-DxNodes
    if (-not $nodes) { Say 'observe: NO 1a86:fe07 nodes at all (unplugged or dead enumeration)'; return $null }
    foreach ($n in $nodes) { Say ("observe: {0,-8} present={1} err={2} {3}" -f $n.Status, $n.Present, $n.Err, $n.InstanceId) }
    $parent = $nodes | Where-Object { $_.InstanceId -like 'USB\VID_1A86&PID_FE07\*' } | Select-Object -First 1
    if ($parent) {
        $p = Get-PnpDeviceProperty -InstanceId $parent.InstanceId -KeyName DEVPKEY_Device_LocationInfo, DEVPKEY_Device_LastArrivalDate, DEVPKEY_Device_LastRemovalDate -ErrorAction SilentlyContinue
        Say ("observe: location={0} arrived={1} removed={2}" -f ($p | ? KeyName -eq DEVPKEY_Device_LocationInfo).Data, ($p | ? KeyName -eq DEVPKEY_Device_LastArrivalDate).Data, ($p | ? KeyName -eq DEVPKEY_Device_LastRemovalDate).Data)
    }
    $ss = powercfg /q SCHEME_CURRENT 2e601130-5351-4d9d-8e04-252966bad054 48e6b7a6-50f5-4782-a5d4-53bb50f7e206 2>$null | Select-String 'Current AC Power Setting Index'
    if ($ss) { Say ("observe: USB selective suspend (AC) = {0}" -f ($ss.Line.Trim() -replace '.*: ', '')) }
    foreach ($pm in (Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction SilentlyContinue | Where-Object { $_.InstanceName -match 'VID_1A86&PID_FE07' })) {
        Say ("observe: idle power-down allowed={0} on {1}" -f $pm.Enable, $pm.InstanceName)
    }
    $nodes
}

function Disable-IdlePowerDown {
    $pms = Get-CimInstance -Namespace root\wmi -ClassName MSPower_DeviceEnable -ErrorAction SilentlyContinue | Where-Object { $_.InstanceName -match 'VID_1A86&PID_FE07' -and $_.Enable }
    foreach ($pm in $pms) {
        $pm.Enable = $false
        Set-CimInstance -InputObject $pm
        Say "power: idle power-down DISABLED on $($pm.InstanceName)"
    }
    if (-not $pms) { Say 'power: idle power-down already off' }
}

function Probe {
    # one control write through hidapi, same as the bridge's first packet
    $py = @'
import hid, sys
ds = [d for d in hid.enumerate(0x1A86, 0xFE07) if d["interface_number"] == 0]
if not ds: print("probe: no HID interface 0"); sys.exit(2)
d = hid.device(); d.open_path(ds[0]["path"])
r = d.write(bytes([0, 0x52, 0x42, 7, 1, 147, 0, 0]) + bytes(57))
print(f"probe: write -> {r} {d.error()}"); d.close(); sys.exit(0 if r > 0 else 1)
'@
    $tmp = Join-Path $env:TEMP 'dx-probe.py'; Set-Content -Path $tmp -Value $py -Encoding ascii
    $out = & $Python $tmp 2>&1; $code = $LASTEXITCODE
    Say ($out -join ' | ')
    return $code -eq 0
}

function Step-DisableEnable {
    $hid = Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'HID\VID_1A86&PID_FE07&MI_00*' } | Select-Object -First 1
    if (-not $hid) { Say 'disable/enable: HID child not present'; return }
    Say "disable/enable: $($hid.InstanceId)"
    Disable-PnpDevice -InstanceId $hid.InstanceId -Confirm:$false
    Start-Sleep 3
    Enable-PnpDevice -InstanceId $hid.InstanceId -Confirm:$false
    Start-Sleep 4
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')

if ($Register) {
    if (-not $isAdmin) { throw 'run -Register from an elevated shell (one time)' }
    $action = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -DisableEnable' -f $PSCommandPath)
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
    Say "registered task $TaskName (RunLevel Highest, S4U)"
    Disable-IdlePowerDown
    return
}

if ($DisableEnable) { Observe | Out-Null; Step-DisableEnable; Disable-IdlePowerDown; Observe | Out-Null; return }

$nodes = Observe
if ($Status) { if ($nodes) { Probe | Out-Null }; return }
if (-not $nodes) { Say 'recover: nothing to do without a device; replug needed'; exit 2 }

if (Probe) { Say 'recover: probe OK, nothing to fix'; exit 0 }

Say 'recover: step 2 reopen handle'
if (Probe) { Say 'recover: fixed by reopen'; exit 0 }

Say 'recover: step 3 disable/enable HID child'
if ($isAdmin) { Step-DisableEnable }
elseif (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Start-ScheduledTask -TaskName $TaskName
    $t0 = Get-Date
    while (((Get-ScheduledTask -TaskName $TaskName).State -eq 'Running') -and ((Get-Date) - $t0).TotalSeconds -lt 60) { Start-Sleep 1 }
}
else { Say "recover: no elevation and task $TaskName not registered -> run scripts\dxlight-recover.ps1 -Register once (elevated)" }
Observe | Out-Null
if (Probe) { Say 'recover: fixed by disable/enable'; exit 0 }

Say 'recover: still failing after disable/enable -> physical replug needed (state above is what a wedge looks like)'
exit 1
