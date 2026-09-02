#requires -version 7
<#
.SYNOPSIS
  Turn a fresh Windows guest into a project server: sshd, Tailscale, git,
  Node/pnpm, and the repo.

.DESCRIPTION
  Run this INSIDE the guest, once, after Windows is installed and Tailscale is
  logged in. It is idempotent: every step checks before acting, so re-running
  after a partial failure is safe.

  Deliberately NOT done here:
    * VS Code Server is not pre-installed. Remote-SSH downloads the exact
      commit each client needs; pinning one here just guarantees a mismatch.
    * No dev container. Measured on this host, a Windows bind mount runs at
      1285 files/s versus 68885 native -- 53x slower -- and this repo holds
      656938 entries.

  sshd's DefaultShell is set to cmd.exe on purpose. With pwsh as the default,
  Remote-SSH's `ssh -T <host> powershell` starts Windows PowerShell 5.1
  INTERACTIVELY; its copyright banner lands in stdout and Remote-SSH reads that
  as a failed handshake, reporting only "Connecting with SSH timed out". That
  cost an afternoon to find on the host -- do not undo it.
#>
param(
    [string]$Repo = 'https://github.com/dragos-vladulescu/brivio.git',
    [string]$Dest = 'E:\gh\brivio',
    [string[]]$Users = @('dragos', 'mihai')
)
$ErrorActionPreference = 'Stop'

function Step($n) { Write-Host ''; Write-Host "  $n" -ForegroundColor Cyan }
function Ok($m) { Write-Host "    $m" -ForegroundColor Green }
function Skip($m) { Write-Host "    $m" -ForegroundColor DarkGray }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host '  run this elevated' -ForegroundColor Red; exit 1
}

Step '1. OpenSSH server'
if ((Get-WindowsCapability -Online -Name 'OpenSSH.Server*').State -ne 'Installed') {
    Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
    Ok 'installed'
}
else { Skip 'already installed' }

Set-Service sshd -StartupType Automatic
if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd }
Ok "sshd $((Get-Service sshd).Status), starts automatically"

# See the header: pwsh here breaks the Remote-SSH handshake.
$k = 'HKLM:\SOFTWARE\OpenSSH'
$cur = (Get-ItemProperty $k -Name DefaultShell -ErrorAction SilentlyContinue).DefaultShell
if ($cur -ne 'C:\Windows\System32\cmd.exe') {
    Set-ItemProperty -Path $k -Name 'DefaultShell' -Value 'C:\Windows\System32\cmd.exe' -Force
    Restart-Service sshd -Force
    Ok 'DefaultShell set to cmd.exe (required by Remote-SSH)'
}
else { Skip 'DefaultShell already cmd.exe' }

Step '2. firewall: SSH only over Tailscale'
if (-not (Get-NetFirewallRule -Name 'sshd-tailscale' -ErrorAction SilentlyContinue)) {
    # 100.64.0.0/10 is the CGNAT range Tailscale uses. Restricting the rule to
    # it means port 22 is unreachable from the LAN or the internet.
    New-NetFirewallRule -Name 'sshd-tailscale' -DisplayName 'SSH (Tailscale only)' `
        -Enabled True -Direction Inbound -Protocol TCP -LocalPort 22 `
        -RemoteAddress '100.64.0.0/10' -Action Allow | Out-Null
    Ok 'port 22 open to 100.64.0.0/10 only'
}
else { Skip 'rule already present' }

Step '3. tooling'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
    Ok 'git installed'
}
else { Skip "git $((git --version) -replace 'git version ','')" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
    Ok 'node installed'
}
else { Skip "node $(node --version)" }

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    corepack enable 2>&1 | Out-Null
    corepack prepare pnpm@latest --activate 2>&1 | Out-Null
    Ok 'pnpm activated via corepack'
}
else { Skip "pnpm $(pnpm --version)" }

Step '4. accounts'
foreach ($u in $Users) {
    if (-not (Get-LocalUser -Name $u -ErrorAction SilentlyContinue)) {
        # No password: these accounts authenticate by SSH key only.
        New-LocalUser -Name $u -NoPassword -Description 'project server, key auth only' `
            -UserMayNotChangePassword | Out-Null
        Add-LocalGroupMember -Group 'Users' -Member $u
        Ok "created $u"
    }
    else { Skip "$u exists" }

    $sshDir = "C:\Users\$u\.ssh"
    if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Force -Path $sshDir | Out-Null }
    $ak = Join-Path $sshDir 'authorized_keys'
    if (-not (Test-Path $ak)) {
        New-Item -ItemType File -Path $ak | Out-Null
        icacls $ak /inheritance:r /grant "${u}:F" 'SYSTEM:F' 'Administrators:F' 2>&1 | Out-Null
        Ok "  $ak ready (add their public key)"
    }
    else { Skip "  authorized_keys present" }
}

Step '5. repository'
if (-not (Test-Path $Dest)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
    git clone $Repo $Dest
    Ok "cloned into $Dest"
}
else { Skip "$Dest already exists" }

# Everyone works in the SAME tree -- that is the point of a project server --
# so the folder is group-writable rather than owned by one account.
foreach ($u in $Users) {
    icacls $Dest /grant "${u}:(OI)(CI)M" /T /Q 2>&1 | Out-Null
}
Ok "read+write granted to: $($Users -join ', ')"

Step 'done'
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
$ip = if (Test-Path $ts) { (& $ts ip -4 2>&1 | Select-Object -First 1) } else { '<run tailscale login>' }
Write-Host "    reachable at: $ip" -ForegroundColor Green
Write-Host ''
Write-Host '    each user adds to their ~/.ssh/config:' -ForegroundColor Cyan
Write-Host "      Host $env:COMPUTERNAME"
Write-Host "          HostName $ip"
Write-Host '          User <their-name>'
Write-Host '          AddressFamily inet'
Write-Host '          ServerAliveInterval 30'
Write-Host ''
Write-Host '    and in VS Code settings:' -ForegroundColor Cyan
Write-Host "      `"remote.SSH.remotePlatform`": { `"$env:COMPUTERNAME`": `"windows`" }"
