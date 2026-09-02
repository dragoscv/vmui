#requires -version 7
<#
.SYNOPSIS
  Install WSL2 + Docker Desktop inside a Hyper-V guest, headless.

.DESCRIPTION
  Run this FIRST on a fresh project server, before any other Windows optional
  feature is touched. See rebuild-project-server.ps1 for why the order matters.

  Rules learned the hard way, all measured on this host:
    * NEVER disable Microsoft-Hyper-V in the guest. WSL2 runs on top of it, and
      disabling it deletes vmcompute.exe permanently -- DISM will not put it
      back and the VM has to be rebuilt.
    * Enabling VirtualMachinePlatform needs a real reboot. Until then WSL2 says
      "virtualization is not enabled on this machine" regardless of the host
      settings, and every CPU flag still reads True, which sends you chasing
      the wrong thing.
    * winget in this image has a corrupt source index ("Data required by the
      source is missing"), so download installers directly.
    * The store version of WSL may be absent; install the standalone MSI from
      the microsoft/WSL releases, resolving the URL on the HOST.

  On the host side the VM must already have: ExposeVirtualizationExtensions,
  static memory, MAC address spoofing. rebuild-project-server.ps1 sets all three.
#>
param(
    [string]$Vm = 'brivio-dev',
    [ValidateSet('workstation', 'project-server')][string]$Kind = 'project-server',
    # A freshly cloned guest still carries the template's account name.
    [string]$GuestUser
)
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib\guest-credentials.ps1')
function Step($m) { Write-Host ''; Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "    $m" -ForegroundColor Green }

$p = Get-VMProcessor -VMName $Vm
if (-not $p.ExposeVirtualizationExtensions) {
    throw "$Vm nu are nested virtualization. Ruleaza: Stop-VM $Vm -Force; Set-VMProcessor -VMName $Vm -ExposeVirtualizationExtensions `$true"
}

$cred = if ($GuestUser) {
    [pscredential]::new($GuestUser, (ConvertTo-SecureString $env:FLEET_GUEST_PASS -AsPlainText -Force))
}
else { Get-VmuiGuestCredential -Kind fleet }

function Wait-Guest {
    do { Start-Sleep 5 } until ((Get-VMIntegrationService -VMName $Vm -Name Heartbeat).PrimaryStatusDescription -eq 'OK')
    Start-Sleep 45
}

Step '1. activez VirtualMachinePlatform + WSL + Hyper-V-Services'
Invoke-Command -VMName $Vm -Credential $cred -ScriptBlock {
    # Microsoft-Hyper-V-Services is what installs vmcompute.exe, the Host
    # Compute Service that hosts the WSL2 utility VM. Enable it HERE, once,
    # while the component store is clean. Never disable it afterwards: the
    # payload does not come back and the VM has to be rebuilt.
    foreach ($f in 'VirtualMachinePlatform', 'Microsoft-Windows-Subsystem-Linux', 'Microsoft-Hyper-V-Services') {
        $st = (Get-WindowsOptionalFeature -Online -FeatureName $f).State
        if ($st -ne 'Enabled') {
            Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart | Out-Null
            "    activat $f"
        }
        else { "    $f deja activ" }
    }
}

Step '2. repornesc (obligatoriu, altfel WSL2 nu vede virtualizarea)'
Restart-VM $Vm -Force
Wait-Guest
$vmc = Invoke-Command -VMName $Vm -Credential $cred -ScriptBlock {
    Test-Path 'C:\Windows\System32\vmcompute.exe'
}
if (-not $vmc) { throw 'vmcompute.exe lipseste dupa activarea Hyper-V-Services -- magazia de componente e deteriorata, reconstruieste VM-ul' }
Ok 'vmcompute.exe prezent'
$st = Invoke-Command -VMName $Vm -Credential $cred -ScriptBlock {
    (wsl --status 2>&1 | Where-Object { $_ -and $_.Trim() }) -join ' '
}
if ($st -match 'unable to start') { throw "WSL2 tot nu porneste dupa reboot: $st" }
Ok 'virtualizarea e vizibila pentru WSL2'

Step '3. instalez kernelul WSL'
$rel = Invoke-RestMethod 'https://api.github.com/repos/microsoft/WSL/releases/latest' -Headers @{ 'User-Agent' = 'vmui' }
$msi = ($rel.assets | Where-Object { $_.name -like '*x64.msi' } | Select-Object -First 1)
Ok "$($rel.tag_name) - $($msi.name)"
Invoke-Command -VMName $Vm -Credential $cred -ArgumentList $msi.browser_download_url -ScriptBlock {
    param($url)
    New-Item -ItemType Directory -Force -Path 'C:\provision' | Out-Null
    if (-not (Test-Path 'C:\provision\wsl.msi')) {
        Invoke-WebRequest -Uri $url -OutFile 'C:\provision\wsl.msi' -UseBasicParsing
    }
    Start-Process msiexec.exe -ArgumentList '/i', 'C:\provision\wsl.msi', '/quiet', '/norestart' -Wait
    "    $((wsl --version 2>&1 | Select-Object -First 1))"
}

Step '4. instalez Docker Desktop'
$s = New-PSSession -VMName $Vm -Credential $cred
try {
    Invoke-Command -Session $s -ScriptBlock {
        $exe = 'C:\provision\DockerDesktopInstaller.exe'
        if (-not (Test-Path 'C:\Program Files\Docker\Docker\Docker Desktop.exe')) {
            if (-not (Test-Path $exe)) {
                # winget's source is broken in this image; fetch directly.
                Invoke-WebRequest -Uri 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe' `
                    -OutFile $exe -UseBasicParsing
            }
            $r = Start-Process $exe -ArgumentList 'install', '--quiet', '--accept-license', `
                '--backend=wsl-2', '--always-run-service' -Wait -PassThru
            "    installer cod $($r.ExitCode)"
        }
        else { '    deja instalat' }
    }
}
finally { Remove-PSSession $s }

Step '5. repornesc si pornesc engine-ul'
Restart-VM $Vm -Force
Wait-Guest
$out = Invoke-Command -VMName $Vm -Credential $cred -ScriptBlock {
    Set-Service com.docker.service -StartupType Automatic
    Start-Service com.docker.service -ErrorAction SilentlyContinue
    if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe' -ArgumentList '-Autostart'
    }
    $env:Path += ';C:\Program Files\Docker\Docker\resources\bin'
    for ($i = 0; $i -lt 60; $i++) {
        $v = docker version --format '{{.Server.Version}}' 2>&1
        if ($LASTEXITCODE -eq 0) { return "OK|$v|$($i*10)" }
        Start-Sleep 10
    }
    "FAIL|$v"
}
$parts = $out -split '\|'
if ($parts[0] -eq 'OK') { Ok "docker engine $($parts[1]) gata dupa $($parts[2]) s" }
else { throw "engine-ul nu porneste: $($parts[1])" }
