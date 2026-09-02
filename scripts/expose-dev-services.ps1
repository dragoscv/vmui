#requires -version 7
<#
.SYNOPSIS
  Expose the host's brivio Docker stack to fleet VMs over Tailscale.

.DESCRIPTION
  Docker cannot run inside the guests on this host: Virtualization-Based
  Security is active on dragos-pc (VirtualizationBasedSecurityStatus = 2), and
  VBS keeps the virtualization extensions for itself, so a nested guest cannot
  hand them to WSL2. Every guest reports "WSL2 is unable to start since
  virtualization is not enabled on this machine" -- including guests that were
  never modified, which is how the cause was finally isolated. Turning VBS off
  needs a host reboot and weakens kernel protection, so the containers stay on
  the host instead.

  The containers already bind 0.0.0.0, so all that is missing is a firewall
  rule. It is scoped to 100.64.0.0/10 (the Tailscale CGNAT range), so these
  ports are unreachable from the LAN or the internet.

  Trade-off, stated plainly: the database is SHARED, not isolated. Anyone who
  corrupts it corrupts it for everyone. For real isolation, disable VBS and run
  the stack inside brivio-dev.

.EXAMPLE
  .\expose-dev-services.ps1
  .\expose-dev-services.ps1 -Remove
#>
param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$rule = 'brivio-dev-services-tailscale'
$ports = @{
    22432 = 'postgres'
    22479 = 'redis'
    22480 = 'dss'
    22580 = 'stalwart http'
    22525 = 'stalwart smtp'
    22587 = 'stalwart submission'
    22143 = 'stalwart imap'
}

if ($Remove) {
    Remove-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue
    Write-Host '  regula stearsa'
    return
}

if (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue) {
    Remove-NetFirewallRule -Name $rule
}
New-NetFirewallRule -Name $rule -DisplayName 'Brivio dev services (Tailscale only)' `
    -Enabled True -Direction Inbound -Protocol TCP `
    -LocalPort ($ports.Keys | Sort-Object) `
    -RemoteAddress '100.64.0.0/10' -Action Allow | Out-Null

$ip = (& 'C:\Program Files\Tailscale\tailscale.exe' ip -4 | Select-Object -First 1).Trim()
Write-Host "  gazda pe Tailscale : $ip"
Write-Host '  porturi deschise doar din 100.64.0.0/10:'
foreach ($p in ($ports.Keys | Sort-Object)) { '    {0}  {1}' -f $p, $ports[$p] }
Write-Host ''
Write-Host '  in .env pe brivio-dev:'
Write-Host "    DATABASE_URL=postgresql://brivio:<parola>@${ip}:22432/brivio"
Write-Host "    REDIS_URL=redis://${ip}:22479"
