#requires -RunAsAdministrator
<#
.SYNOPSIS
  Enable + harden OpenSSH Server on a Hyper-V Windows guest, *without* needing
  the guest to be reachable over IP. Uses PowerShell Direct (`Invoke-Command
  -VMName`) which talks to the guest over the VMBus.

.DESCRIPTION
  Idempotent. Safe to re-run. Performs inside the guest:
    1. Add-WindowsCapability OpenSSH.Server (with retry -- on a freshly-booted
       Windows the WU service may take ~30s to come online).
    2. Set sshd + ssh-agent to Automatic and start them.
    3. Open inbound firewall on port 22 for ALL profiles (the built-in rule
       only covers Domain/Private; Hyper-V Default Switch lands the guest on
       Public).
    4. Force PowerShell as the default SSH shell (so `ssh dragos@...` drops
       you into pwsh, not legacy cmd).

.PARAMETER VmName
  Target VM. Default: vmui-win (matches scripts/setup-win-hyperv.ps1).

.PARAMETER Username
  Local Administrator username inside the guest. Default: dragos.

.PARAMETER Password
  Plaintext password for the guest local admin. Default: $env:WIN_GUEST_PASS.

.EXAMPLE
  pwsh -File scripts\enable-ssh-hyperv.ps1
  pwsh -File scripts\enable-ssh-hyperv.ps1 -VmName vmui-win -Username dragos -Password $env:WIN_GUEST_PASS
#>
[CmdletBinding()]
param(
  [string]$VmName   = 'vmui-win',
  [string]$Username = 'dragos',
  # Resolved below from .private/credentials.env when not supplied. It cannot
  # default to $env:WIN_GUEST_PASS here: param defaults are evaluated before
  # the body runs, so the credential loader has not executed yet.
  [string]$Password
)

$ErrorActionPreference = 'Stop'

# Guest credentials come from .private/credentials.env (gitignored).
. "$PSScriptRoot\lib\guest-credentials.ps1"
if (-not $Password) { $Password = $env:WIN_GUEST_PASS }
if (-not $Password) {
  throw "No guest password. Create .private\credentials.env (see .private.example\README.md) or pass -Password."
}

function Wait-VmReady {
  param([string]$Name, [int]$TimeoutSec = 300)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  Write-Host "Waiting for VM '$Name' integration services to be ready..."
  while ((Get-Date) -lt $deadline) {
    $hb = (Get-VMIntegrationService -VMName $Name -Name Heartbeat -ErrorAction SilentlyContinue).PrimaryStatusDescription
    if ($hb -eq 'OK') { return }
    Start-Sleep 3
  }
  throw "VM '$Name' did not report a healthy heartbeat within ${TimeoutSec}s."
}

$vm = Get-VM -Name $VmName -ErrorAction Stop
if ($vm.State -ne 'Running') {
  Write-Host "VM '$VmName' is $($vm.State) -- starting it..."
  Start-VM -Name $VmName | Out-Null
}
Wait-VmReady -Name $VmName

$secure = ConvertTo-SecureString $Password -AsPlainText -Force
$cred   = [System.Management.Automation.PSCredential]::new(".\$Username", $secure)

# The script block executed *inside* the guest. It is self-contained -- we do
# not pull host-scope variables (would otherwise need the using: scope
# qualifier).
$scriptBlock = {
  $ErrorActionPreference = 'Continue'
  $report = [ordered]@{}

  Write-Output "[guest] hostname = $env:COMPUTERNAME"

  # 1) Capability install -- retry while WU service warms up.
  $cap = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' |
         Select-Object -First 1
  if ($cap.State -ne 'Installed') {
    for ($i = 0; $i -lt 6; $i++) {
      try {
        Add-WindowsCapability -Online -Name $cap.Name -ErrorAction Stop | Out-Null
        Write-Output "[guest] OpenSSH.Server capability installed"
        break
      } catch {
        Write-Output "[guest] capability install attempt $($i+1) failed: $($_.Exception.Message). Sleeping 10s..."
        Start-Sleep 10
      }
    }
  } else {
    Write-Output "[guest] OpenSSH.Server already installed"
  }
  $report.capability = (Get-WindowsCapability -Online -Name 'OpenSSH.Server*' |
                        Select-Object -First 1).State

  # 2) Services.
  Set-Service -Name sshd        -StartupType Automatic -ErrorAction SilentlyContinue
  Set-Service -Name 'ssh-agent' -StartupType Automatic -ErrorAction SilentlyContinue
  Start-Service sshd        -ErrorAction SilentlyContinue
  Start-Service 'ssh-agent' -ErrorAction SilentlyContinue
  $report.sshdStatus     = (Get-Service sshd        -ErrorAction SilentlyContinue).Status
  $report.sshAgentStatus = (Get-Service 'ssh-agent' -ErrorAction SilentlyContinue).Status

  # 3) Firewall -- built-in rule may only cover Private/Domain. Add a rule
  #    that covers Public too, with a stable name so re-runs are idempotent.
  $ruleName = 'OpenSSH-Server-In-TCP-vmui'
  if (-not (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule `
      -Name $ruleName `
      -DisplayName 'OpenSSH Server (vmui, all profiles)' `
      -Enabled True `
      -Direction Inbound `
      -Protocol TCP `
      -LocalPort 22 `
      -Action Allow `
      -Profile Any | Out-Null
    Write-Output "[guest] firewall rule $ruleName created"
  } else {
    Write-Output "[guest] firewall rule $ruleName already exists"
  }
  $report.firewall = (Get-NetFirewallRule -Name $ruleName).Enabled

  # 4) Default shell → PowerShell.
  $opensshKey = 'HKLM:\SOFTWARE\OpenSSH'
  if (-not (Test-Path $opensshKey)) { New-Item -Path $opensshKey -Force | Out-Null }
  Set-ItemProperty -Path $opensshKey `
    -Name DefaultShell `
    -Value 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
    -Force
  $report.defaultShell = (Get-ItemProperty -Path $opensshKey -Name DefaultShell).DefaultShell

  # 5) IP report -- handy for the host.
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
        Select-Object -First 1 -ExpandProperty IPAddress
  $report.ip = $ip

  $report
}

Write-Host "Invoking guest configuration over PowerShell Direct..."
$result = Invoke-Command -VMName $VmName -Credential $cred -ScriptBlock $scriptBlock

Write-Host ""
Write-Host "=== Result ===" -ForegroundColor Cyan
$result | Format-List

if ($result.ip) {
  Write-Host ""
  Write-Host "Connect with:" -ForegroundColor Green
  Write-Host "  ssh $Username@$($result.ip)"
}

