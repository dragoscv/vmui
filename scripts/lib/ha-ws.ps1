# Dot-source. Minimal synchronous Home Assistant WebSocket client.
# Requires HA_URL / HA_TOKEN in the environment (see lib/guest-credentials.ps1).
#
# Top-level state is $script:; function locals are safe as-is (a function has
# its own scope even when the file is dot-sourced). Only file-level bare
# variables leak into the caller -- that is what once overwrote a -Name param.

$script:HaWsId = 0

function Invoke-HaWs {
    <#
    .SYNOPSIS Send one WebSocket command and return its result (throws on failure).
    .EXAMPLE Invoke-HaWs @{ type = 'config_entries/flow/progress' }
    #>
    param([Parameter(Mandatory)][hashtable]$Message, [int]$TimeoutSec = 120)

    $uri = [Uri](($env:HA_URL -replace '^http', 'ws') + '/api/websocket')
    $ws = [Net.WebSockets.ClientWebSocket]::new()
    $cts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSec))
    try {
        $ws.ConnectAsync($uri, $cts.Token).GetAwaiter().GetResult()
        $recv = {
            $b = [byte[]]::new(1MB); $sb = [Text.StringBuilder]::new()
            do {
                $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($b), $cts.Token).GetAwaiter().GetResult()
                [void]$sb.Append([Text.Encoding]::UTF8.GetString($b, 0, $r.Count))
            } while (-not $r.EndOfMessage)
            $sb.ToString() | ConvertFrom-Json
        }
        $send = {
            param($o)
            $x = [Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Depth 20 -Compress))
            $ws.SendAsync([ArraySegment[byte]]::new($x), 'Text', $true, $cts.Token).GetAwaiter().GetResult()
        }
        if ((& $recv).type -ne 'auth_required') { throw 'unexpected greeting' }
        & $send @{ type = 'auth'; access_token = $env:HA_TOKEN }
        $auth = & $recv
        if ($auth.type -ne 'auth_ok') { throw "HA websocket auth failed: $($auth.message)" }

        $Message.id = ++$script:HaWsId
        & $send $Message
        do { $reply = & $recv } while ($reply.id -ne $Message.id)
        if (-not $reply.success) { throw "HA $($Message.type): $($reply.error.code) $($reply.error.message)" }
        return $reply.result
    }
    finally { $ws.Dispose(); $cts.Dispose() }
}

function Invoke-HaRest {
    <# .SYNOPSIS REST call with the long-lived token. #>
    param([Parameter(Mandatory)][string]$Path, [string]$Method = 'GET', $Body)
    $h = @{ Authorization = "Bearer $env:HA_TOKEN" }
    $u = "$($env:HA_URL.TrimEnd('/'))$Path"
    if ($null -eq $Body) { return Invoke-RestMethod -Method $Method -Uri $u -Headers $h }
    Invoke-RestMethod -Method $Method -Uri $u -Headers $h -Body ($Body | ConvertTo-Json -Depth 20 -Compress) -ContentType 'application/json'
}

function Get-HaPendingFlows {
    Invoke-HaWs @{ type = 'config_entries/flow/progress' }
}

function Step-HaFlow {
    <#
    .SYNOPSIS Advance a config flow. Returns the flow state (form / progress / create_entry / abort).
    .EXAMPLE Step-HaFlow -FlowId $id -Data @{ pin = '1234' }
    #>
    param([Parameter(Mandatory)][string]$FlowId, $Data = @{})
    Invoke-HaRest -Path "/api/config/config_entries/flow/$FlowId" -Method POST -Body $Data
}

function Start-HaFlow {
    <# .SYNOPSIS Start a user-initiated config flow for a domain. #>
    param([Parameter(Mandatory)][string]$Domain)
    Invoke-HaRest -Path '/api/config/config_entries/flow' -Method POST -Body @{ handler = $Domain; show_advanced_options = $true }
}

function Get-HaFlow {
    param([Parameter(Mandatory)][string]$FlowId)
    Invoke-HaRest -Path "/api/config/config_entries/flow/$FlowId"
}
