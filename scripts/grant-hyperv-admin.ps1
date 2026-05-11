# One-time elevated helper:
#   - Adds the current (or specified) user to the local "Hyper-V Administrators"
#     group so they can manage Hyper-V VMs without UAC prompts thereafter.
#   - Ensures "Default Switch" is present.
#
# Run this ONCE from an elevated PowerShell. After running, sign out and
# back in for the new group membership to take effect in non-elevated
# shells. Subsequent calls to setup/start/stop scripts won't need UAC.
#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$User = "$env:USERDOMAIN\$env:USERNAME")

$ErrorActionPreference = 'Stop'

$group = 'Hyper-V Administrators'
$already = Get-LocalGroupMember -Group $group -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ieq $User }

if ($already) {
  Write-Host "$User is already a member of '$group'."
} else {
  Write-Host "Adding $User to '$group'..."
  Add-LocalGroupMember -Group $group -Member $User
  Write-Host "Done. SIGN OUT and back in for the change to take effect."
}

# Confirm Default Switch
$sw = Get-VMSwitch -Name 'Default Switch' -ErrorAction SilentlyContinue
if (-not $sw) {
  Write-Warning "'Default Switch' not found. Hyper-V usually creates it automatically. You can create one manually with:"
  Write-Host "    New-VMSwitch -Name vmui-nat -SwitchType Internal"
} else {
  Write-Host "Default Switch present: $($sw.Name) ($($sw.SwitchType))"
}
