# Dot-source. Minimal synchronous HyperHDR JSON-API client over WebSocket.
#
# The HTTP /json-rpc endpoint is stateless, so an admin `login` there does
# not carry to the next request and every config write answers
# "No Authorization". A WebSocket session keeps the login, so that is the
# transport for anything beyond serverinfo.
#
# Defaults: http://127.0.0.1:8090, admin password "hyperhdr" (change it).

$script:HyperTan = 0

function Invoke-Hyper {
    <#
    .SYNOPSIS Send one or more commands in a single authenticated WS session.
    .EXAMPLE Invoke-Hyper @{ command = 'serverinfo' }
    .EXAMPLE Invoke-Hyper @(@{command='config';subcommand='getconfig'}) -Instance 1
    #>
    param(
        [Parameter(Mandatory)][object[]]$Commands,
        # Instance the session operates on. The `config` command rejects an
        # `instance` field (additionalProperties:false), so the selection is
        # made once per session with instance/switchTo.
        [int]$Instance = 0,
        [string]$BaseUrl = ($env:HYPERHDR_URL ?? 'http://127.0.0.1:8090'),
        [string]$Password = ($env:HYPERHDR_ADMIN_PASS ?? 'hyperhdr'),
        [int]$TimeoutSec = 30
    )
    $uri = [Uri](($BaseUrl -replace '^http', 'ws'))
    $ws = [Net.WebSockets.ClientWebSocket]::new()
    $cts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSec))
    try {
        $ws.ConnectAsync($uri, $cts.Token).GetAwaiter().GetResult()
        $recv = {
            $b = [byte[]]::new(4MB); $sb = [Text.StringBuilder]::new()
            do {
                $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($b), $cts.Token).GetAwaiter().GetResult()
                [void]$sb.Append([Text.Encoding]::UTF8.GetString($b, 0, $r.Count))
            } while (-not $r.EndOfMessage)
            $sb.ToString() | ConvertFrom-Json -Depth 50
        }
        $send = {
            param($o)
            $o.tan = ++$script:HyperTan
            $x = [Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Depth 50 -Compress))
            $ws.SendAsync([ArraySegment[byte]]::new($x), 'Text', $true, $cts.Token).GetAwaiter().GetResult()
            do { $reply = & $recv } while ($reply.tan -ne $o.tan)
            $reply
        }
        $auth = & $send @{ command = 'authorize'; subcommand = 'login'; password = $Password }
        if (-not $auth.success) { throw "HyperHDR login failed: $($auth.error)" }
        if ($Instance -ne 0) {
            $sw = & $send @{ command = 'instance'; subcommand = 'switchTo'; instance = $Instance }
            if (-not $sw.success) { throw "HyperHDR switchTo $Instance failed: $($sw.error)" }
        }
        $out = foreach ($c in $Commands) {
            $r = & $send $c
            if (-not $r.success) { throw "HyperHDR $($c.command)/$($c.subcommand): $($r.error) $($r.errorData | ConvertTo-Json -Compress)" }
            $r
        }
        return $out
    }
    finally { $ws.Dispose(); $cts.Dispose() }
}

function Get-HyperConfig {
    param([int]$Instance = 0)
    (Invoke-Hyper @(@{ command = 'config'; subcommand = 'getconfig' }) -Instance $Instance).info
}

function Set-HyperConfig {
    <# .SYNOPSIS Merge a partial config (top-level sections) into HyperHDR. #>
    param([Parameter(Mandatory)][hashtable]$Config, [int]$Instance = 0)
    Invoke-Hyper @(@{ command = 'config'; subcommand = 'setconfig'; config = $Config }) -Instance $Instance | Out-Null
}

function Get-HyperServerInfo {
    (Invoke-Hyper @(@{ command = 'serverinfo' })).info
}
