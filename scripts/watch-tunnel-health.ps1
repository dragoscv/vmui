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
        leaks        = $r.leaks - $prev.leaks
        disposals    = $r.disposals - $prev.disposals
        downloads    = $r.downloads - $prev.downloads
        procs        = $r.tunnelProcs
        regs         = $r.tunnelRegs
      }
      if ($d.reconnects -or $d.ws1006 -or $d.unresponsive -or $d.disposals -or $d.shutdowns) { $events += $d }
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
  Write-Host "  window reloads       : $(($reloads | Measure-Object shutdowns -Sum).Sum)  <- these kill the chat"
  Write-Host "  network drops (1006) : $(($drops | Measure-Object ws1006 -Sum).Sum)  (reconnect loop recovers these)"
  Write-Host "  listener leaks       : $(($events | Measure-Object leaks -Sum).Sum)  (suspect an extension if this tracks reloads)"
  if ($reloads.Count) {
    Write-Host '  when reloads happened:' -ForegroundColor DarkGray
    $reloads | Select-Object -Last 8 | ForEach-Object { Write-Host "    $($_.t)  x$($_.shutdowns)" -ForegroundColor DarkGray }
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
  $disposals = 0; $downloads = 0; $noServer = 0
  if (Test-Path $tlog) {
    $disposals = @(Select-String -Path $tlog -Pattern 'Disposed of connection to running server' -EA SilentlyContinue).Count
    $downloads = @(Select-String -Path $tlog -Pattern 'Downloading Visual Studio Code server' -EA SilentlyContinue).Count
    $noServer = @(Select-String -Path $tlog -Pattern 'NoAttachedServerError' -EA SilentlyContinue).Count
  }

  # VM side: the counters that actually describe the symptom.
  # NOT named $vm — PowerShell variables are case-insensitive, so that would
  # clobber the $VM parameter holding the machine name, and Invoke-Command
  # would be handed a hashtable as -VMName.
  $guest = @{ reconnects = -1; ws1006 = -1; unresponsive = -1; shutdowns = -1; leaks = -1; freeMB = -1 }
  try {
    $cred = Get-VmuiGuestCredential -Kind win
    $guest = Invoke-Command -VMName $VM -Credential $cred -EA Stop -ScriptBlock {
      $f = Get-ChildItem "$env:APPDATA\Code - Insiders\logs" -Recurse -Filter 'renderer.log' -EA SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if (-not $f) { return @{ reconnects = -1; ws1006 = -1; unresponsive = -1; shutdowns = -1; leaks = -1; freeMB = -1 } }
      @{
        reconnects   = @(Select-String -Path $f.FullName -Pattern 'reconnected!' -EA SilentlyContinue).Count
        ws1006       = @(Select-String -Path $f.FullName -Pattern 'status code 1006' -EA SilentlyContinue).Count
        unresponsive = @(Select-String -Path $f.FullName -Pattern 'is unresponsive' -EA SilentlyContinue).Count
        # The decisive signal. A window RELOAD logs onWillShutdown; a network
        # drop does not. Today: 1 shutdown vs 2×1006, which is how we learned
        # the reconnects recover on their own and the interrupted chat was a
        # deliberate reload instead.
        shutdowns    = @(Select-String -Path $f.FullName -Pattern 'onWillShutdown' -EA SilentlyContinue).Count
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
    leaks        = $guest.leaks
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
