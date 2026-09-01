<#
.SYNOPSIS
  Record tunnel and extension-host health so the next drop is diagnosable.

.DESCRIPTION
  Diagnosing this took three sessions because nothing was recorded: by the time
  a freeze was noticed, the evidence was a log tail and a process census taken
  hours later. Two wrong causes were chased first (VM memory, then host
  memory) because the real signals — reconnect rate and duplicate tunnel
  identities — were invisible.

  This samples every minute and appends one JSON line per sample to
  `~/.codai/tunnel-health.jsonl`. It is deliberately cheap: no log parsing on
  the hot path, just counters.

  What it captures, and why each earned its place:
    tunnelProcs   a pile-up of these was the first root cause (102 processes)
    tunnelRegs    TWO registrations named "dragos" was the second
    reconnects    3/min was the symptom that proved the second fix worked
    ws1006        the abnormal-close code that precedes every termination
    unresponsive  the user-visible symptom
    vmFreeMB      to rule memory in or out with data, not assumption

  Usage:
    watch-tunnel-health.ps1              # run in the foreground
    watch-tunnel-health.ps1 -Once        # single sample, for a scheduled task
    watch-tunnel-health.ps1 -Report      # summarise what has been collected

.NOTES
  Reads the VM over PowerShell Direct, so it must run on the host.
#>
[CmdletBinding()]
param(
  [switch]$Once,
  [switch]$Report,
  [int]$IntervalSec = 60,
  [string]$VM = 'dragos-dev',
  [string]$OutFile = "$env:USERPROFILE\.codai\tunnel-health.jsonl"
)

$ErrorActionPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force -Path (Split-Path $OutFile) | Out-Null

# Hard stop. This is temporary diagnostics, not a permanent background job, and
# a forgotten sampler is exactly the kind of thing that runs for months.
# The scheduled task also carries an EndBoundary, but do not rely on it alone:
# re-registering or importing the task can drop it silently.
$script:Deadline = Join-Path (Split-Path $OutFile) 'tunnel-health.deadline'
if (-not (Test-Path $script:Deadline)) {
  (Get-Date).AddDays(3).ToString('o') | Set-Content $script:Deadline
}
if ([datetime]::Parse((Get-Content $script:Deadline -Raw).Trim()) -lt (Get-Date)) {
  # Past the deadline: tear the whole thing down rather than just exiting,
  # otherwise the task keeps firing every 2 minutes forever doing nothing.
  Unregister-ScheduledTask -TaskName 'TunnelHealthSampler' -Confirm:$false -EA SilentlyContinue
  "$(Get-Date -Format 'o')  sampler expired, task removed" | Add-Content "$OutFile.log"
  exit 0
}

# Resolve once at script scope: $PSScriptRoot is not reliably populated inside
# a function, which made the credential import fail silently and report -1 for
# every VM field.
$script:CredLib = Join-Path $PSScriptRoot 'lib\guest-credentials.ps1'
if (Test-Path $script:CredLib) { . $script:CredLib }

# ---------------------------------------------------------------- report ----
if ($Report) {
  if (-not (Test-Path $OutFile)) { Write-Host 'no samples yet'; exit 0 }
  $rows = Get-Content $OutFile | ForEach-Object { $_ | ConvertFrom-Json }
  Write-Host "samples: $($rows.Count)   from $($rows[0].t) to $($rows[-1].t)"
  Write-Host ''

  # Only deltas matter: the log counters are cumulative.
  $prev = $null; $events = @()
  foreach ($r in $rows) {
    if ($prev) {
      $d = [pscustomobject]@{
        t            = $r.t
        reconnects   = $r.reconnects - $prev.reconnects
        ws1006       = $r.ws1006 - $prev.ws1006
        unresponsive = $r.unresponsive - $prev.unresponsive
        shutdowns    = $r.shutdowns - $prev.shutdowns
        tokenReuse   = $r.tokenReuse - $prev.tokenReuse
        permanent    = $r.permanent - $prev.permanent
        chatKilled   = $r.chatKilled - $prev.chatKilled
        leaks        = $r.leaks - $prev.leaks
        disposals    = $r.disposals - $prev.disposals
        downloads    = $r.downloads - $prev.downloads
        procs        = $r.tunnelProcs
        regs         = $r.tunnelRegs
      }
      if ($d.reconnects -or $d.ws1006 -or $d.unresponsive -or $d.disposals -or $d.shutdowns -or $d.permanent) { $events += $d }
    }
    $prev = $r
  }

  if (-not $events.Count) {
    Write-Host 'no reconnects, no 1006s, no freezes in the whole window.' -ForegroundColor Green
  } else {
    Write-Host "$($events.Count) sample(s) with activity:" -ForegroundColor Yellow
    $events | Select-Object -Last 25 | Format-Table -AutoSize
  }

  $bad = @($rows | Where-Object { $_.tunnelRegs -gt 1 })
  if ($bad.Count) {
    Write-Host ''
    Write-Host "WARNING: more than one tunnel registration in $($bad.Count) sample(s)." -ForegroundColor Red
    Write-Host 'Two tunnels sharing a name is the duplicate-identity failure.' -ForegroundColor Red
  }
  $peak = ($rows | Measure-Object tunnelProcs -Maximum).Maximum
  if ($peak -gt 4) {
    Write-Host ''
    Write-Host "WARNING: tunnel processes peaked at $peak (expected 2-3)." -ForegroundColor Red
  }

  # The distinction that matters: a disposal WITH a download is the client
  # updating (unavoidable, one server at a time). A disposal WITHOUT one is
  # connection churn, and that is the part still unexplained.
  $churn = @($events | Where-Object { $_.disposals -gt 0 -and $_.downloads -eq 0 })
  $upd = @($events | Where-Object { $_.downloads -gt 0 })
  Write-Host ''
  Write-Host "server swaps: $(($events | Measure-Object disposals -Sum).Sum) total" -ForegroundColor Cyan
  Write-Host "  from a client update : $(($upd | Measure-Object downloads -Sum).Sum)  (expected; tunnel holds one server)"
  Write-Host "  unexplained churn    : $(($churn | Measure-Object disposals -Sum).Sum)  <- the open question"
  if ($churn.Count) {
    Write-Host '  when churn happened:' -ForegroundColor DarkGray
    $churn | Select-Object -Last 8 | ForEach-Object { Write-Host "    $($_.t)  x$($_.disposals)" -ForegroundColor DarkGray }
  }

  # What actually interrupts a chat session. A 1006 is recovered automatically
  # by the reconnect loop; a window reload is not, and it kills the extension
  # host with it.
  $reloads = @($events | Where-Object { $_.shutdowns -gt 0 })
  $drops = @($events | Where-Object { $_.ws1006 -gt 0 })
  Write-Host ''
  Write-Host 'what interrupted the session:' -ForegroundColor Cyan
  # Root cause, established 2026-08-31: a reconnect makes the ExtensionHost
  # channel reuse a token the Management channel already consumed. VS Code
  # treats that as PERMANENT and stops retrying, so the extension host stays
  # dead until the user reloads by hand. The reload is the CURE, not the
  # disease -- which is why every host exit is code 0.
  Write-Host "  token reuse          : $(($events | Measure-Object tokenReuse -Sum).Sum)  <- ROOT CAUSE"
  Write-Host "  proxy aborts         : $(($events | Measure-Object proxyAborts -Sum).Sum)  <- ORIGIN: the client's own proxy gives up first"
  Write-Host "  permanent give-ups   : $(($events | Measure-Object permanent -Sum).Sum)  <- extension host dead, needs manual reload"
  Write-Host "  chat requests killed : $(($events | Measure-Object chatKilled -Sum).Sum)"
  Write-Host "  network drops (1006) : $(($drops | Measure-Object ws1006 -Sum).Sum)  (harmless on their own)"
  Write-Host "  manual reloads       : $(($reloads | Measure-Object shutdowns -Sum).Sum)  (recovery, not cause)"
  Write-Host "  listener leaks       : $(($events | Measure-Object leaks -Sum).Sum)  (perf only; does NOT track reloads)"
  if ($reloads.Count) {
    Write-Host '  when reloads happened:' -ForegroundColor DarkGray
    $reloads | Select-Object -Last 8 | ForEach-Object { Write-Host "    $($_.t)  x$($_.shutdowns)" -ForegroundColor DarkGray }
  }

  # Second, independent failure mode. Tonight's outage had ZERO movement in
  # every counter above, so absence of churn is not evidence of health.
  $withMem = @($rows | Where-Object { $_.PSObject.Properties.Name -contains 'hostRendMB' -and $_.hostRendMB })
  if ($withMem.Count) {
    $peak = ($withMem | Measure-Object hostRendMB -Maximum).Maximum
    $last = $withMem[-1]
    Write-Host ''
    Write-Host 'host renderer memory (independent cause):' -ForegroundColor Cyan
    Write-Host "  peak observed        : $peak MB"
    Write-Host "  now                  : $($last.hostRendMB) MB  (pid $($last.hostRendPid), up $($last.hostRendAgeH)h)"
    if ($last.hostRendMB -ge 3000) {
      Write-Host '  WARNING: a renderer over ~3 GB will stop responding. Reload that window.' -ForegroundColor Red
    }
    elseif ($peak -ge 3000) {
      Write-Host '  a renderer previously exceeded 3 GB -- watch the growth rate.' -ForegroundColor Yellow
    }
  }

  # Third cause, and the only one that leaves every other counter flat.
  $withSrv = @($rows | Where-Object { $_.PSObject.Properties.Name -contains 'serverCommits' -and $_.serverCommits })
  if ($withSrv.Count) {
    $n = ($withSrv | Measure-Object serverCommits -Maximum).Maximum
    Write-Host ''
    Write-Host 'tunnel server swaps (root cause):' -ForegroundColor Cyan
    Write-Host "  distinct servers served today : $n"
    if ($n -gt 1) {
      Write-Host '  The Insiders CLIENT updated underneath the STABLE tunnel, forcing a' -ForegroundColor Red
      Write-Host '  server download and swap mid-session. Set "update.mode": "start".' -ForegroundColor Red
    }
  }

  # Liveness. NOTE: absence of a host-side `cli\servers\` process is NORMAL in
  # this topology and is NOT a fault -- an earlier version of this report
  # claimed otherwise and was wrong. The relay socket is the real signal.
  $withRelay = @($rows | Where-Object { $_.PSObject.Properties.Name -contains 'relayLinks' })
  if ($withRelay.Count) {
    $last = $withRelay[-1]
    Write-Host ''
    Write-Host 'tunnel liveness:' -ForegroundColor Cyan
    Write-Host "  relay connections now : $($last.relayLinks)"
    if ($last.relayLinks -eq 0) {
      Write-Host '  the tunnel holds no relay connection - it is genuinely offline.' -ForegroundColor Red
    }
    else {
      Write-Host '  tunnel is up (the workbench runs in the VM; no host server process is expected).'
    }
  }

  # The upstream cause. Everything in "what interrupted the session" above is
  # downstream of this.
  $withUp = @($rows | Where-Object { $_.PSObject.Properties.Name -contains 'tunnelUpH' -and $_.tunnelUpH -ge 0 })
  if ($withUp.Count) {
    $last = $withUp[-1]
    Write-Host ''
    Write-Host 'tunnel service uptime (UPSTREAM CAUSE):' -ForegroundColor Cyan
    Write-Host "  up for                : $($last.tunnelUpH) h"
    Write-Host "  connections disposed today : $($last.disposalsToday)"
    if ($last.tunnelUpH -ge 40) {
      Write-Host '  RESTART IT. Past ~40 h the service disposes a connection every ~60 min,' -ForegroundColor Red
      Write-Host '  and each disposal can hit the token-reuse bug and kill the chat session.' -ForegroundColor Red
      Write-Host '  Elevated: Stop-ScheduledTask VSCodeTunnel-dragos; kill code-tunnel; Start-ScheduledTask.' -ForegroundColor Red
    }
    elseif ($last.tunnelUpH -ge 24) {
      Write-Host '  over 24 h - watch the disposal count; restart if it starts climbing hourly.' -ForegroundColor Yellow
    }
  }

  $withSw = @($rows | Where-Object { $_.PSObject.Properties.Name -contains 'vmSwitch' -and $_.vmSwitch })
  if ($withSw.Count) {
    $sw = $withSw[-1].vmSwitch
    Write-Host ''
    Write-Host 'VM network:' -ForegroundColor Cyan
    Write-Host "  Hyper-V switch : $sw"
    if ($sw -eq 'Default Switch') {
      Write-Host '  BACK ON NAT. The Default Switch drops idle connections with no log entry' -ForegroundColor Red
      Write-Host '  on either side. Move it back to the external switch.' -ForegroundColor Red
    }
  }
  exit 0
}

# ---------------------------------------------------------------- sample ----
function Get-Sample {
  # Host side: cheap, no elevation needed.
  $procs = @(Get-Process code-tunnel -EA SilentlyContinue).Count
  $regs = @(
    "$env:USERPROFILE\.vscode\cli\code_tunnel.json",
    "$env:USERPROFILE\.vscode-insiders\cli\code_tunnel.json"
  ) | Where-Object { Test-Path $_ }

  # Host tunnel log. Today's measurement: 18 "Disposed of connection" but only
  # 2 downloads, so client updates explain ~11% of interruptions. Counting both
  # separates "the client updated" from "the connection churned", which the
  # earlier fields could not distinguish.
  $tlog = "$env:USERPROFILE\.vscode\cli\tunnel-service.log"

  # HOST renderer memory. Added after 2026-08-31 19:34: a renderer that had
  # been alive since 12:48 reached 7 063 MB private heap and the window stopped
  # responding, while every VM-side counter stayed frozen (tokenReuse 8,
  # permanent 4, unchanged for over an hour). Electron renderers become
  # unstable well below this, so the growth curve is the early warning the
  # other counters cannot give.
  $rendererMB = 0; $rendererPid = 0; $rendererAgeH = 0
  foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name='Code - Insiders.exe'" -EA SilentlyContinue)) {
    if ($proc.CommandLine -notmatch '--type=renderer') { continue }
    $mb = [int]($proc.WorkingSetSize / 1MB)
    if ($mb -le $rendererMB) { continue }
    $rendererMB = $mb
    $rendererPid = $proc.ProcessId
    $p = Get-Process -Id $proc.ProcessId -EA SilentlyContinue
    if ($p) { $rendererAgeH = [math]::Round(((Get-Date) - $p.StartTime).TotalHours, 1) }
  }

  $disposals = 0; $downloads = 0; $noServer = 0
  if (Test-Path $tlog) {
    $disposals = @(Select-String -Path $tlog -Pattern 'Disposed of connection to running server' -EA SilentlyContinue).Count
    $downloads = @(Select-String -Path $tlog -Pattern 'Downloading Visual Studio Code server' -EA SilentlyContinue).Count
    $noServer = @(Select-String -Path $tlog -Pattern 'NoAttachedServerError' -EA SilentlyContinue).Count
  }

  # ROOT CAUSE, found 2026-08-31. The tunnel on this host is started by STABLE
  # (`Microsoft VS Code\bin\code-tunnel.exe`, task VSCodeTunnel-dragos), while
  # the VM connects with Insiders. Quality is per-connection, so the tunnel
  # serves whatever commit the CLIENT asks for -- and Insiders ships a new
  # commit daily. On 2026-08-31 alone it served three: d5ceefbe -> db46a82c ->
  # 5c917327. Each switch downloads a new server and tears down the extension
  # host mid-session. More than one distinct server in a day means the client
  # is updating underneath the tunnel.
  $serverCommits = 0
  if (Test-Path $tlog) {
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $seen = @{}
    foreach ($m in @(Select-String -Path $tlog -Pattern 'servers\\((?:Insiders|Stable)-\w{10})' -EA SilentlyContinue)) {
      if ($m.Line -notmatch [regex]::Escape($today)) { continue }
      if ($m.Line -match 'servers\\((?:Insiders|Stable)-\w{10})') { $seen[$Matches[1]] = 1 }
    }
    $serverCommits = $seen.Count
  }

  # Liveness, measured the only way that is actually true here.
  #
  # A WRONG version of this check shipped on 2026-08-31 and reported a healthy
  # tunnel as "dead". It counted host processes matching `cli\servers\` and
  # found zero -- but zero is the NORMAL state. In this topology the VM runs
  # the workbench itself and dials out to the relay; the host tunnel brokers
  # the connection and keeps no long-lived local server process. Two further
  # traps made the wrong answer look convincing: `Get-CimInstance` returns an
  # empty `CommandLine`/`ExecutablePath` for processes this unelevated session
  # cannot open (18 node.exe were invisible), and a stale LAST log entry is
  # also normal, because the log is only appended on connection events.
  #
  # The honest signal is the relay socket. If the tunnel process holds an
  # ESTABLISHED connection to the relay, the tunnel is up.
  $tunnelPids = @(Get-Process 'code-tunnel' -EA SilentlyContinue).Id
  $relayLinks = 0
  if ($tunnelPids.Count) {
    $relayLinks = @(Get-NetTCPConnection -State Established -EA SilentlyContinue |
        Where-Object { $_.OwningProcess -in $tunnelPids -and $_.RemotePort -eq 443 }).Count
  }

  # UPSTREAM CAUSE, found 2026-09-01. The token-reuse failures are not random:
  # they follow the tunnel disposing a connection, which it started doing every
  # ~60 min once the service had been up ~45 h. Measured that day: 16
  # token-reuse in 10.6 h (1.51/h) versus 0.33-0.57/h on the three preceding
  # days, and 29 disposals plus 89 NoAttachedServerError in one log.
  # Restarting the service reset it. Track uptime so the next degradation is
  # visible before it costs a session.
  $tunnelUpH = -1
  if ($tunnelPids.Count) {
    $oldest = $null
    foreach ($tp in $tunnelPids) {
      $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$tp" -EA SilentlyContinue
      if ($ci -and $ci.CreationDate) {
        if (-not $oldest -or $ci.CreationDate -lt $oldest) { $oldest = $ci.CreationDate }
      }
    }
    if ($oldest) { $tunnelUpH = [math]::Round(((Get-Date) - $oldest).TotalHours, 1) }
  }
  $disposalsToday = 0
  if (Test-Path $tlog) {
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $disposalsToday = @(Select-String -Path $tlog -Pattern 'Disposed of connection' -EA SilentlyContinue |
        Where-Object { $_.Line -match [regex]::Escape($today) }).Count
  }

  # Which Hyper-V switch the VM is on. It was 'Default Switch' until
  # 2026-09-01: an Internal switch with a NAT layer that silently drops idle
  # connections and reassigns the VM's subnet on every host reboot. That
  # matches the failure signature exactly -- a socket close with NOTHING
  # preceding it in either log, while memory, routing and the relay were all
  # healthy. Moved to the external switch, so the VM now sits directly on the
  # LAN (192.168.100.x, 0 ms from the host) with no NAT in the path.
  $vmSwitch = ''
  try {
    $vmSwitch = (Get-VMNetworkAdapter -VMName $VM -Name 'Network Adapter' -EA Stop).SwitchName
  }
  catch { $vmSwitch = 'unknown' }

  # VM side: the counters that actually describe the symptom.
  # NOT named $vm — PowerShell variables are case-insensitive, so that would
  # clobber the $VM parameter holding the machine name, and Invoke-Command
  # would be handed a hashtable as -VMName.
  $guest = @{ reconnects = -1; ws1006 = -1; unresponsive = -1; shutdowns = -1; leaks = -1; tokenReuse = -1; permanent = -1; chatKilled = -1; proxyAborts = -1; freeMB = -1 }
  try {
    $cred = Get-VmuiGuestCredential -Kind win
    $guest = Invoke-Command -VMName $VM -Credential $cred -EA Stop -ScriptBlock {
      $f = Get-ChildItem "$env:APPDATA\Code - Insiders\logs" -Recurse -Filter 'renderer.log' -EA SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if (-not $f) { return @{ reconnects = -1; ws1006 = -1; unresponsive = -1; shutdowns = -1; leaks = -1; tokenReuse = -1; permanent = -1; chatKilled = -1; proxyAborts = -1; freeMB = -1 } }
      @{
        reconnects   = @(Select-String -Path $f.FullName -Pattern 'reconnected!' -EA SilentlyContinue).Count
        ws1006       = @(Select-String -Path $f.FullName -Pattern 'status code 1006' -EA SilentlyContinue).Count
        unresponsive = @(Select-String -Path $f.FullName -Pattern 'is unresponsive' -EA SilentlyContinue).Count
        # The decisive signal. A window RELOAD logs onWillShutdown; a network
        # drop does not. Today: 1 shutdown vs 2×1006, which is how we learned
        # the reconnects recover on their own and the interrupted chat was a
        # deliberate reload instead.
        shutdowns    = @(Select-String -Path $f.FullName -Pattern 'onWillShutdown' -EA SilentlyContinue).Count
        # The actual cause of an interrupted chat. On reconnect the Management
        # channel and the ExtensionHost channel race for the same new socket;
        # Management wins, ExtensionHost is then told its token was "seen
        # before", and that is classified PERMANENT, so the reconnect loop
        # gives up for good. Measured: permanent == tokenReuse / 2 in all 7
        # sessions, i.e. token reuse ALWAYS kills the extension host.
        tokenReuse   = @(Select-String -Path $f.FullName -Pattern 'Unknown reconnection token' -EA SilentlyContinue).Count
        permanent    = @(Select-String -Path $f.FullName -Pattern 'A permanent error occurred' -EA SilentlyContinue).Count
        chatKilled   = @(Select-String -Path $f.FullName -Pattern 'Error while handling chat request: Canceled' -EA SilentlyContinue).Count
        # THE decisive signal, found 2026-09-01. The client's own tunnel proxy
        # gives up 31 ms BEFORE the socket close, and the socket in question is
        # 127.0.0.1 -- inside the VM. So the failure never touches the network
        # we spent four rounds "fixing" (uptime, NAT, memory, updates). Read
        # from the Remote-Tunnels extension log, which nothing else looks at.
        proxyAborts  = $(
          $rt = Get-ChildItem "$env:APPDATA\Code - Insiders\logs" -Recurse -Filter 'Remote - Tunnels.log' -EA SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
          if ($rt) {
            @(Select-String -Path $rt.FullName -Pattern 'Tunnel connection closed with' -EA SilentlyContinue).Count
          } else { -1 }
        )
        # A listener leak preceded today's reload by 30s. Correlation only so
        # far, but it is free to count and would implicate an extension.
        leaks        = @(Select-String -Path $f.FullName -Pattern 'listener LEAK detected' -EA SilentlyContinue).Count
        freeMB       = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB)
      }
    }
  } catch {
    # -1 means "could not read the VM", which is itself a signal worth seeing.
    # Swallowing the reason silently is what made this hard to debug.
    $script:LastVmError = $_.Exception.Message
  }

  [pscustomobject]@{
    t            = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    tunnelProcs  = $procs
    tunnelRegs   = $regs.Count
    reconnects   = $guest.reconnects
    ws1006       = $guest.ws1006
    unresponsive = $guest.unresponsive
    shutdowns    = $guest.shutdowns
    tokenReuse   = $guest.tokenReuse
    permanent    = $guest.permanent
    chatKilled   = $guest.chatKilled
    proxyAborts  = $guest.proxyAborts
    leaks        = $guest.leaks
    hostRendMB   = $rendererMB
    hostRendPid  = $rendererPid
    hostRendAgeH = $rendererAgeH
    serverCommits = $serverCommits
    relayLinks    = $relayLinks
    tunnelUpH     = $tunnelUpH
    disposalsToday = $disposalsToday
    vmSwitch      = $vmSwitch
    vmFreeMB     = $guest.freeMB
    disposals    = $disposals
    downloads    = $downloads
    noServer     = $noServer
  }
}

if ($Once) {
  (Get-Sample | ConvertTo-Json -Compress) | Add-Content $OutFile
  exit 0
}

Write-Host "sampling every ${IntervalSec}s -> $OutFile   (Ctrl+C to stop)" -ForegroundColor Cyan
$prev = $null
while ($true) {
  $s = Get-Sample
  ($s | ConvertTo-Json -Compress) | Add-Content $OutFile
  $flag = ''
  if ($prev -and $s.reconnects -gt $prev.reconnects) { $flag += " reconnect+$($s.reconnects - $prev.reconnects)" }
  if ($prev -and $s.ws1006 -gt $prev.ws1006) { $flag += " 1006+$($s.ws1006 - $prev.ws1006)" }
  if ($s.tunnelRegs -gt 1) { $flag += ' DUPLICATE-REG' }
  Write-Host ("{0}  procs={1} regs={2} free={3}MB{4}" -f $s.t, $s.tunnelProcs, $s.tunnelRegs, $s.vmFreeMB, $flag) `
    -ForegroundColor $(if ($flag) { 'Yellow' } else { 'DarkGray' })
  $prev = $s
  Start-Sleep -Seconds $IntervalSec
}
