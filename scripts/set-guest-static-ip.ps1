<#
.SYNOPSIS
  Set a static IP on each VM's `vmnet` adapter, over PowerShell Direct.

.DESCRIPTION
  RUN ELEVATED on the host. Pairs with setup-vm-network.ps1.

  The `vmnet` switch is Internal with no DHCP, so the guests sit on APIPA
  (169.254.x) until this runs. Static is the whole point: it is what makes the
  address survive a host reboot, which Hyper-V's Default Switch does not
  guarantee — it renumbers its subnet, which is what moved the VM addresses and
  broke RDP by name in the first place.

  The guest's OTHER adapter (Default Switch) is left alone, so an in-flight RDP
  session keeps working while you move over.

  Gateway/DNS are deliberately NOT set on this adapter: the Default Switch NIC
  already provides the default route. Two default gateways on one machine is a
  routing coin-flip. Outbound traffic that does use 10.10.10.0/24 is handled by
  the host NAT.

.NOTES
  Idempotent. Re-run after any guest rebuild.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [hashtable]$Assign = @{ 'dragos-dev' = '10.10.10.10'; 'brivio' = '10.10.10.20' },
  [int]$PrefixLength = 24,
  [string]$AdapterName = 'vmnet'
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run elevated.' -ForegroundColor Red; exit 1
}

. "$PSScriptRoot\lib\guest-credentials.ps1"
$base = Get-VmuiGuestCredential -Kind win

foreach ($vm in $Assign.Keys) {
  $ip = $Assign[$vm]
  Write-Host "`n=== $vm -> $ip ===" -ForegroundColor Cyan

  if (-not (Get-VM $vm -EA SilentlyContinue)) { Write-Host '  no such VM'; continue }

  # The clone's account was renamed, so the username differs per VM.
  $user = if ($vm -eq 'brivio') { 'brivio' } else { $base.UserName }
  $cred = [pscredential]::new($user, $base.Password)

  # Match by MAC: adapter aliases inside Windows are unpredictable
  # ("Ethernet 2", "Ethernet 3"), but the MAC is authoritative.
  $mac = (Get-VMNetworkAdapter -VMName $vm | Where-Object { $_.SwitchName -eq $AdapterName }).MacAddress
  if (-not $mac) { Write-Host "  no $AdapterName adapter" -ForegroundColor Yellow; continue }

  if (-not $PSCmdlet.ShouldProcess($vm, "set $ip on MAC $mac")) { continue }

  try {
    $r = Invoke-Command -VMName $vm -Credential $cred -ArgumentList $mac, $ip, $PrefixLength -ScriptBlock {
      param($Mac, $Ip, $Prefix)
      $fmt = ($Mac -replace '(..)', '$1-').TrimEnd('-')
      $nic = Get-NetAdapter | Where-Object { $_.MacAddress -eq $fmt }
      if (-not $nic) { return "no adapter with MAC $fmt" }

      $cur = Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -EA SilentlyContinue
      if ($cur.IPAddress -contains $Ip) { return "already $Ip on '$($nic.Name)'" }

      # Drop APIPA/DHCP first, or New-NetIPAddress refuses.
      $cur | Remove-NetIPAddress -Confirm:$false -EA SilentlyContinue
      Set-NetIPInterface -InterfaceIndex $nic.ifIndex -Dhcp Disabled -EA SilentlyContinue
      New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $Ip -PrefixLength $Prefix -EA Stop | Out-Null

      # Private, so RDP and file sharing are not blocked as they are on Public.
      Set-NetConnectionProfile -InterfaceIndex $nic.ifIndex -NetworkCategory Private -EA SilentlyContinue
      return "set $Ip on '$($nic.Name)' (profile Private)"
    }
    Write-Host "  $r" -ForegroundColor Green
  } catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host "`n=== verify ===" -ForegroundColor Cyan
foreach ($vm in $Assign.Keys) {
  $ip = $Assign[$vm]
  $ok = (Test-NetConnection -ComputerName $ip -Port 3389 -WarningAction SilentlyContinue).TcpTestSucceeded
  Write-Host ("  {0,-12} {1,-14} rdp={2}" -f $vm, $ip, $(if ($ok) { 'OK' } else { 'not yet' })) `
    -ForegroundColor $(if ($ok) { 'Green' } else { 'Yellow' })
}
