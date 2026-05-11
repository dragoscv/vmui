# vmui — backward-compat shim.
#
# This script forwards everything to the generic watchdog-vm.ps1 with
# -Kind mac. Existing call sites (autostart scheduled tasks, ad-hoc shell
# invocations) keep working unchanged. New code should call watchdog-vm.ps1
# directly.

param(
  [string]$Distro = "Ubuntu-24.04",
  [int]$AllocatedRamMb = 16384,
  [int]$Cores = 4,
  [int]$Threads = 8,
  [int]$VncDisplay = 0,
  [int]$QmpPort = 4444,
  [int]$SshPort = 10022,
  [int]$RestartDelaySec = 5,
  [int]$MaxRestarts = 0
)

& (Join-Path $PSScriptRoot "watchdog-vm.ps1") `
  -Distro $Distro `
  -Kind mac `
  -AllocatedRamMb $AllocatedRamMb `
  -Cores $Cores `
  -Threads $Threads `
  -VncDisplay $VncDisplay `
  -QmpPort $QmpPort `
  -SshPort $SshPort `
  -RestartDelaySec $RestartDelaySec `
  -MaxRestarts $MaxRestarts
