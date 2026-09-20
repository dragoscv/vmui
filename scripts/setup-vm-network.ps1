<#
.SYNOPSIS
  Give the VMs stable, predictable addresses on a dedicated Internal switch
  with NAT for outbound internet.

.DESCRIPTION
  RUN ELEVATED.

  Why not DHCP reservations: Hyper-V's `Default Switch` runs an internal DHCP
  service with no administrable scope — there is no `Add-DhcpServerv4Reservation`
  for it. It also renumbers its own subnet on some host reboots, which is what
  made the VM addresses move and broke RDP by name.

  This replaces that with a subnet we own:

      vmnet (Internal)   10.10.10.0/24
      host gateway       10.10.10.1
      dragos-dev         10.10.10.10
      brivio             10.10.10.20

  Addresses are set STATICALLY inside each guest, so nothing can renumber them.
  A NAT on the host provides outbound internet. Verified free before use:
  10.10.10.0/24 collides with none of the existing subnets (172.28.240.0/20,
  172.23.192.0/20, 192.168.100.0/24).

  The existing adapters are left connected — each VM ends up dual-homed, so an
  in-flight RDP session over the old address survives while you move over.

.NOTES
  Idempotent: safe to re-run. Skips anything already in place.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$SwitchName = 'vmnet',
  [string]$Subnet = '10.10.10.0/24',
  [string]$HostIP = '10.10.10.1',
  [int]$PrefixLength = 24,
  [hashtable]$Assign = @{ 'dragos-dev' = '10.10.10.10'; 'brivio' = '10.10.10.20' }
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run elevated (Run as Administrator).' -ForegroundColor Red; exit 1
}

function Step($n, $m) { Write-Host "`n[$n] $m" -ForegroundColor Cyan }

# --- 1. switch ---------------------------------------------------------------
Step 1 "Internal switch '$SwitchName'"
if (Get-VMSwitch -Name $SwitchName -EA SilentlyContinue) {
  Write-Host '  already exists'
} elseif ($PSCmdlet.ShouldProcess($SwitchName, 'New-VMSwitch -SwitchType Internal')) {
  New-VMSwitch -Name $SwitchName -SwitchType Internal | Out-Null
  Write-Host '  created' -ForegroundColor Green
}

# --- 2. host address on that switch -----------------------------------------
Step 2 "Host gateway $HostIP"
$alias = "vEthernet ($SwitchName)"
$existing = Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 -EA SilentlyContinue |
  Where-Object { $_.IPAddress -eq $HostIP }
if ($existing) {
  Write-Host '  already set'
} elseif ($PSCmdlet.ShouldProcess($alias, "assign $HostIP/$PrefixLength")) {
  # Clear any stale autoconfiguration first, or New-NetIPAddress conflicts.
  Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 -EA SilentlyContinue |
    Remove-NetIPAddress -Confirm:$false -EA SilentlyContinue
  New-NetIPAddress -InterfaceAlias $alias -IPAddress $HostIP -PrefixLength $PrefixLength | Out-Null
  Write-Host '  assigned' -ForegroundColor Green
}

# --- 3. NAT for outbound internet -------------------------------------------
Step 3 "NAT for $Subnet"
if (Get-NetNat -EA SilentlyContinue | Where-Object { $_.InternalIPInterfaceAddressPrefix -eq $Subnet }) {
  Write-Host '  already exists'
} elseif ($PSCmdlet.ShouldProcess($Subnet, 'New-NetNat')) {
  New-NetNat -Name "$SwitchName-nat" -InternalIPInterfaceAddressPrefix $Subnet | Out-Null
  Write-Host '  created' -ForegroundColor Green
}

# --- 4. attach each VM -------------------------------------------------------
Step 4 'Attaching VMs'
foreach ($vm in $Assign.Keys) {
  if (-not (Get-VM $vm -EA SilentlyContinue)) { Write-Host "  $vm — no such VM, skipping" -ForegroundColor Yellow; continue }
  $has = Get-VMNetworkAdapter -VMName $vm | Where-Object { $_.SwitchName -eq $SwitchName }
  if ($has) {
    Write-Host "  $vm — already attached"
  } elseif ($PSCmdlet.ShouldProcess($vm, "add adapter on $SwitchName")) {
    # A SECOND adapter, deliberately: the existing one keeps the current RDP
    # session alive while you switch over.
    Add-VMNetworkAdapter -VMName $vm -Name $SwitchName -SwitchName $SwitchName
    Write-Host "  $vm — adapter added" -ForegroundColor Green
  }
}

Write-Host ''
Write-Host '=== next: static IPs inside each guest ================' -ForegroundColor Yellow
$Assign.GetEnumerator() | ForEach-Object {
  Write-Host ("  {0,-12} -> {1}" -f $_.Key, $_.Value) -ForegroundColor Gray
}
Write-Host 'Run set-guest-static-ip.ps1 next; it configures them over PowerShell Direct.' -ForegroundColor Gray
