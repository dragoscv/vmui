<#
.SYNOPSIS
  Turn the cloned guest into "brivio". Run INSIDE the clone, elevated.

.DESCRIPTION
  A clone is byte-identical to its source, so until this runs there are two
  machines claiming one hostname and one Tailscale node. Run it BEFORE the
  clone reaches the network alongside dragos-dev.

  Changes: hostname DRAGOS-DEV -> BRIVIO, local account dragos -> brivio,
  Tailscale re-registered as a new node.

  The profile folder stays C:\Users\dragos. That is deliberate and was chosen
  explicitly: Windows renames the account but never the profile folder, and
  moving it means rewriting ProfileImagePath plus every absolute path baked
  into the registry and app configs — which here already includes
  .copilot\agents and .claude\rules. `whoami` will say brivio; the path will
  not. Cosmetic, and safe.

.NOTES
  Reboot required at the end. Sign back in as "brivio" with the SAME password.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$OldUser = 'dragos',
  [string]$NewUser = 'brivio',
  [string]$NewHostname = 'BRIVIO'
)

$ErrorActionPreference = 'Stop'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Run elevated.' -ForegroundColor Red; exit 1
}

# Refuse to run on the original. Renaming dragos-dev's account out from under
# a working session is exactly the mistake this guard exists to prevent.
if ($env:COMPUTERNAME -eq $NewHostname) { Write-Host 'Already renamed.' -ForegroundColor Green; exit 0 }
Write-Host "current hostname: $env:COMPUTERNAME"
if ($env:COMPUTERNAME -ne 'DRAGOS-DEV') {
  Write-Host "Expected DRAGOS-DEV. Refusing to touch an unexpected machine." -ForegroundColor Red
  exit 1
}

# --- 1. account --------------------------------------------------------------
Write-Host "`n[1] Renaming local account $OldUser -> $NewUser" -ForegroundColor Cyan
$u = Get-LocalUser -Name $OldUser -EA SilentlyContinue
if (-not $u) {
  Write-Host "  no local user '$OldUser' — skipping" -ForegroundColor Yellow
} elseif ($PSCmdlet.ShouldProcess($OldUser, "rename to $NewUser")) {
  Rename-LocalUser -Name $OldUser -NewName $NewUser
  # FullName is what the sign-in screen shows; leaving it stale is confusing.
  Set-LocalUser -Name $NewUser -FullName $NewUser
  Write-Host "  done. SID unchanged (…$($u.SID.Value.Split('-')[-1])), so permissions carry over." -ForegroundColor Green
  Write-Host "  profile folder stays C:\Users\$OldUser — by design." -ForegroundColor DarkGray
}

# --- 2. Tailscale ------------------------------------------------------------
# Must happen before the reboot: two nodes sharing one identity make Tailscale
# reassign the address, and then neither is reachable at a predictable IP.
Write-Host "`n[2] Re-registering Tailscale as a new node" -ForegroundColor Cyan
if (Get-Command tailscale -EA SilentlyContinue) {
  if ($PSCmdlet.ShouldProcess('tailscale', 'logout')) {
    tailscale logout 2>&1 | Out-Null
    Write-Host "  logged out. After reboot run:  tailscale up --hostname=$($NewHostname.ToLower())" -ForegroundColor Green
  }
} else {
  Write-Host '  tailscale not installed — skipping' -ForegroundColor Yellow
}

# --- 3. hostname (last: it forces the reboot) --------------------------------
Write-Host "`n[3] Renaming computer -> $NewHostname" -ForegroundColor Cyan
if ($PSCmdlet.ShouldProcess($env:COMPUTERNAME, "rename to $NewHostname")) {
  Rename-Computer -NewName $NewHostname -Force
  Write-Host '  queued; applies on reboot' -ForegroundColor Green
}

Write-Host ''
Write-Host '=== reboot now, then ==================================' -ForegroundColor Yellow
Write-Host @"
  1. sign in as '$NewUser' (same password as before)
  2. tailscale up --hostname=$($NewHostname.ToLower())
  3. check both VMs are distinct:
       hostname            -> BRIVIO
       tailscale ip -4     -> a NEW address, not 100.114.196.12
"@ -ForegroundColor Gray
