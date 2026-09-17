<#
.SYNOPSIS
  Fixed vocabulary of PC actions callable by an agent (vmui /api/mcp `pc_action`).

  No arbitrary shell: every verb is a named branch, so the MCP surface can be
  described to a model and audited. Elevated verbs go through the existing
  CodaiMaint-* scheduled tasks (no UAC); everything else runs as the user.

.EXAMPLE
  pc-action.ps1 -Action lock
  pc-action.ps1 -Action volume -Value 30
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('lock', 'sleep', 'display_off', 'volume', 'mute', 'unmute',
                 'restart_tunnel', 'unfreeze_vscode', 'kill_runaway_renderer',
                 'restart_ambilight', 'restart_turzx', 'restart_vmui')]
    [string]$Action,
    [int]$Value = -1
)
$ErrorActionPreference = 'Stop'

Add-Type -Namespace VmuiPc -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool LockWorkStation();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr SendMessage(System.IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("powrprof.dll", SetLastError = true)] public static extern bool SetSuspendState(bool hibernate, bool force, bool disableWakeEvent);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
'@

function Send-Key([byte]$vk) {
    [VmuiPc.Native]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
    [VmuiPc.Native]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
}

function Run-Task([string]$Name) {
    schtasks /run /tn $Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "schtasks /run $Name failed ($LASTEXITCODE)" }
}

switch ($Action) {
    'lock'        { [void][VmuiPc.Native]::LockWorkStation() }
    'sleep'       { [void][VmuiPc.Native]::SetSuspendState($false, $false, $false) }
    # WM_SYSCOMMAND / SC_MONITORPOWER / 2 = off, to the broadcast window.
    'display_off' { [void][VmuiPc.Native]::SendMessage([IntPtr]0xFFFF, 0x0112, [IntPtr]0xF170, [IntPtr]2) }
    'mute'        { Send-Key 0xAD }
    'unmute'      { Send-Key 0xAD }
    'volume' {
        if ($Value -lt 0 -or $Value -gt 100) { throw 'volume needs -Value 0..100' }
        # Media keys move 2 % per press; drive to 0 then up. Deterministic
        # enough for an agent; no third-party mixer dependency.
        1..50 | ForEach-Object { Send-Key 0xAE }
        1..[int][Math]::Round($Value / 2) | ForEach-Object { Send-Key 0xAF }
    }
    'restart_tunnel'        { Run-Task 'CodaiMaint-TunnelForceRestart' }
    'unfreeze_vscode'       { Run-Task 'CodaiMaint-RestartRemoteExtHost' }
    'kill_runaway_renderer' { Run-Task 'CodaiMaint-KillRunawayRenderer' }
    'restart_ambilight' {
        foreach ($t in 'vmui-ambilight-hyperhdr', 'vmui-ambilight-bridges') { schtasks /end /tn $t | Out-Null; Run-Task $t }
    }
    'restart_turzx' { schtasks /end /tn vmui-turzx | Out-Null; Run-Task 'vmui-turzx' }
    # schtasks /run is a no-op while the task is Running; the service script
    # kills the listener tree and respawns.
    'restart_vmui'  { & "$PSScriptRoot\vmui-service.ps1" -Restart | Out-Null }
}
Write-Output "ok $Action"
