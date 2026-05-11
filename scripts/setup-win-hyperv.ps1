# vmui — Windows 11 Hyper-V Gen2 VM provisioning, fully unattended.
#
# Pipeline:
#   1. Resolve credentials (parameterised; password auto-generated if blank).
#   2. Mount the stock Microsoft Win11 ISO and copy its contents to a staging
#      folder on the host filesystem.
#   3. Drop the rendered autounattend.xml at the root of the staging folder.
#   4. Re-pack staging + autounattend.xml into a new bootable ISO using
#      `oscdimg.exe` from the Windows ADK (proper UDF + multi-boot El Torito,
#      with the no-prompt EFI boot loader so Hyper-V Gen2 doesn't pause for
#      "Press any key to boot from CD").
#   5. Create a Hyper-V Gen2 VM with vTPM, Secure Boot (Microsoft template),
#      nested virtualisation enabled, attach the baked ISO, and start it.
#
# Why this is more robust than the previous WSL/xorriso pipeline:
#   - oscdimg is Microsoft's own ISO builder. It produces a UDF-1.02 image
#     identical in structure to the Microsoft-shipped install media, so
#     bootmgr/winload don't trip over filesystem differences mid-boot.
#   - We use `efisys_noprompt.bin` instead of `efisys.bin`, eliminating the
#     "press any key" prompt for unattended boot.
#   - All credential and naming inputs are parameters, so this VM uses
#     dragos/REDACTED_GUEST_PASSWORD by default but future VMs can specify -Username +
#     auto-generated password.
#
# Requirements:
#   - Run from an elevated PowerShell (or be a member of "Hyper-V
#     Administrators"). See scripts/grant-hyperv-admin.ps1.
#   - Windows ADK Deployment Tools installed (oscdimg). See
#     scripts/install-adk-oscdimg.ps1.
#   - Windows 11 Enterprise install ISO at -WindowsIsoPath.
[CmdletBinding()]
param(
  [string]$VmName        = 'vmui-win',
  [string]$Username      = 'dragos',
  [string]$Password      = '',
  [string]$ComputerName  = '',
  [string]$WindowsIsoPath = 'E:\Hyper-V\vmui\Win11-Enterprise.iso',
  [string]$VmDir         = "$env:USERPROFILE\vmui-hyperv\win",
  [string]$StagingDir    = 'E:\Hyper-V\vmui\stage-win',
  [string]$OutputIsoDir  = 'E:\Hyper-V\vmui',
  [int]$DiskGb           = 200,
  [int]$RamMb            = 8192,
  [int]$Cpus             = 4,
  [string]$SwitchName    = 'Default Switch',
  [string]$ImageName     = 'Windows 11 Enterprise',
  [switch]$ForceRecreate,
  [switch]$KeepStaging,
  [switch]$SkipIsoBuild
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib\win-credentials.ps1"
. "$PSScriptRoot\lib\win-autounattend.ps1"

# ---------------------------------------------------------------------------
# 0. Sanity checks.
# ---------------------------------------------------------------------------
try { Get-VMHost -ErrorAction Stop | Out-Null }
catch {
  Write-Error @"
Hyper-V cmdlets unavailable: $($_.Exception.Message)

Run from an elevated PowerShell, or run scripts/grant-hyperv-admin.ps1 once
to add your account to the local "Hyper-V Administrators" group.
"@
  exit 2
}

if (-not (Test-Path $WindowsIsoPath)) {
  Write-Error "Windows ISO not found: $WindowsIsoPath"
  exit 3
}
if (-not (Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue)) {
  Write-Error "VM switch '$SwitchName' not found."
  exit 4
}

$oscdimg = 'C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe'
if (-not (Test-Path $oscdimg)) {
  Write-Error "oscdimg.exe not found at: $oscdimg`nRun scripts/install-adk-oscdimg.ps1 first (elevated)."
  exit 5
}

# ---------------------------------------------------------------------------
# 1. Resolve credentials.
# ---------------------------------------------------------------------------
$cred = Resolve-VmuiCredential -Username $Username -Password $Password
$Username = $cred.Username
$Password = $cred.Password
if (-not $ComputerName) { $ComputerName = ($VmName -replace '[^A-Za-z0-9-]','-').ToUpper() }
if ($ComputerName.Length -gt 15) { $ComputerName = $ComputerName.Substring(0, 15) }

Write-Host ""
Write-Host "=== vmui Hyper-V Win11 setup ==="
Write-Host "VM name      : $VmName"
Write-Host "Computer name: $ComputerName"
Write-Host "Username     : $Username"
Write-Host "Password     : $Password"
Write-Host "Source ISO   : $WindowsIsoPath"
Write-Host ""

# ---------------------------------------------------------------------------
# 2. Build the unattended ISO (skippable for re-runs).
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $OutputIsoDir | Out-Null
$bakedIso = Join-Path $OutputIsoDir ("Win11-vmui-$VmName.iso")

if (-not $SkipIsoBuild -or -not (Test-Path $bakedIso)) {

  Write-Host "[1/5] Mounting source ISO..."
  $mount = Mount-DiskImage -ImagePath $WindowsIsoPath -PassThru
  try {
    $vol = ($mount | Get-Volume)
    $isoDrive = "$($vol.DriveLetter):"
    Write-Host "      mounted at $isoDrive"

    if (Test-Path $StagingDir) {
      Write-Host "[2/5] Cleaning staging dir..."
      # robocopy /MIR is faster for delete than Remove-Item -Recurse on big trees.
      $empty = Join-Path $env:TEMP ("vmui-empty-" + [guid]::NewGuid())
      New-Item -ItemType Directory -Force -Path $empty | Out-Null
      & robocopy $empty $StagingDir /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
      Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item $empty -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $StagingDir | Out-Null

    Write-Host "[3/5] Copying ISO contents to staging (~6.7 GB)..."
    # /MIR mirrors, /COPY:DAT preserves D=Data A=Attrs T=Timestamps (skip ACL).
    # /R:1 /W:1 keeps it from hanging on transient errors.
    # /XJ avoids junctions. Suppress noisy per-file output.
    $rc = & robocopy "$isoDrive\" $StagingDir /MIR /COPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NJH /NJS /NC /NS /NP
    # robocopy exit codes: 0-7 are success, >=8 is error.
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }
  }
  finally {
    Dismount-DiskImage -ImagePath $WindowsIsoPath | Out-Null
  }

  Write-Host "[4/5] Writing autounattend.xml..."
  $autounattendPath = Join-Path $StagingDir 'autounattend.xml'
  $xml = New-VmuiAutounattendXml -Username $Username `
                                  -Password $Password `
                                  -ComputerName $ComputerName `
                                  -ImageName $ImageName
  # Setup expects UTF-8. Use a writer that does NOT emit a BOM.
  [System.IO.File]::WriteAllText($autounattendPath, $xml, [System.Text.UTF8Encoding]::new($false))
  Write-Host "      wrote $autounattendPath ($((Get-Item $autounattendPath).Length) bytes)"

  Write-Host "[5/5] Repacking with oscdimg..."
  $etfsBoot = Join-Path $StagingDir 'boot\etfsboot.com'
  $efiSysNoPrompt = Join-Path $StagingDir 'efi\microsoft\boot\efisys_noprompt.bin'
  if (-not (Test-Path $etfsBoot)) { throw "Missing $etfsBoot" }
  if (-not (Test-Path $efiSysNoPrompt)) { throw "Missing $efiSysNoPrompt" }

  # Multi-boot ISO: BIOS uses etfsboot.com, UEFI uses efisys_noprompt.bin.
  # `-m` removes the 4.5 GB image size limit (Win11 ISO is ~6.7 GB).
  # `-o` deduplicates identical files via MD5 hash to keep size sane.
  # `-u2` produces UDF-only filesystem (Win11 setup expects UDF for >4 GB
  #     install.wim; ISO9660 fallback would corrupt files >4 GB).
  # `-udfver102` is the version Windows Setup supports.
  # `-l` sets the volume label.
  $bootData = "2#p0,e,b$etfsBoot#pEF,e,b$efiSysNoPrompt"
  $args = @(
    '-m'
    '-o'
    '-u2'
    '-udfver102'
    '-lWIN11_VMUI'
    "-bootdata:$bootData"
    $StagingDir
    $bakedIso
  )
  Write-Host "      oscdimg $($args -join ' ')"
  # Run oscdimg via Start-Process with file redirection. Calling oscdimg
  # directly trips `$ErrorActionPreference='Stop'` because oscdimg emits its
  # progress on stderr (PowerShell promotes any native stderr line to a
  # terminating error under that preference).
  $stdoutLog = Join-Path $env:TEMP "vmui-oscdimg-out.log"
  $stderrLog = Join-Path $env:TEMP "vmui-oscdimg-err.log"
  $proc = Start-Process -FilePath $oscdimg -ArgumentList $args `
                        -NoNewWindow -Wait -PassThru `
                        -RedirectStandardOutput $stdoutLog `
                        -RedirectStandardError  $stderrLog
  if (Test-Path $stdoutLog) { Get-Content $stdoutLog | ForEach-Object { Write-Host $_ } }
  if (Test-Path $stderrLog) { Get-Content $stderrLog | ForEach-Object { Write-Host "      [stderr] $_" } }
  if ($proc.ExitCode -ne 0) { throw "oscdimg failed (exit $($proc.ExitCode))" }
  Write-Host "      built $bakedIso ($((Get-Item $bakedIso).Length) bytes)"

  if (-not $KeepStaging) {
    Write-Host "      cleaning staging dir..."
    $empty = Join-Path $env:TEMP ("vmui-empty-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    & robocopy $empty $StagingDir /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    Remove-Item $StagingDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $empty -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "Reusing existing baked ISO: $bakedIso"
}

# ---------------------------------------------------------------------------
# 3. Create / recreate the Hyper-V VM.
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "[VM] Provisioning Hyper-V VM..."

# vTPM key protector (UntrustedGuardian = local self-signed; fine for dev).
$guardian = Get-HgsGuardian -Name 'UntrustedGuardian' -ErrorAction SilentlyContinue
if (-not $guardian) {
  Write-Host "      creating UntrustedGuardian (one-time)..."
  $guardian = New-HgsGuardian -Name 'UntrustedGuardian' -GenerateCertificates
}

New-Item -ItemType Directory -Force -Path $VmDir | Out-Null

$existing = Get-VM -Name $VmName -ErrorAction SilentlyContinue
if ($existing -and $ForceRecreate) {
  Write-Host "      ForceRecreate: removing existing VM..."
  if ($existing.State -ne 'Off') { Stop-VM -Name $VmName -TurnOff -Force }
  Remove-VM -Name $VmName -Force
  $existing = $null
}

if (-not $existing) {
  $vhd = Join-Path $VmDir 'Win11.vhdx'
  if (Test-Path $vhd) { Remove-Item $vhd -Force }
  Write-Host "      creating VHDX ($DiskGb GB)..."
  New-VHD -Path $vhd -SizeBytes ($DiskGb * 1GB) -Dynamic | Out-Null

  Write-Host "      creating Gen2 VM..."
  New-VM -Name $VmName `
         -Generation 2 `
         -MemoryStartupBytes ($RamMb * 1MB) `
         -VHDPath $vhd `
         -SwitchName $SwitchName `
         -Path $VmDir | Out-Null

  Set-VM -Name $VmName `
         -ProcessorCount $Cpus `
         -CheckpointType Disabled `
         -AutomaticStartAction Nothing `
         -AutomaticStopAction Save

  # Expose VT-x to the guest. Win11 25H2 enables VBS/HVCI on first boot which
  # needs CR4.VMXE; without nested virt enabled the guest triple-faults.
  Set-VMProcessor -VMName $VmName -ExposeVirtualizationExtensions $true
  Set-VMMemory    -VMName $VmName -DynamicMemoryEnabled $false

  # Attach the baked ISO as the only DVD. autounattend.xml lives at its root,
  # so no sidecar drive needed.
  Add-VMDvdDrive -VMName $VmName -Path $bakedIso
  $dvd = Get-VMDvdDrive -VMName $VmName
  $hdd = Get-VMHardDiskDrive -VMName $VmName

  # Be explicit about the boot order — DVD first, then HDD.
  Set-VMFirmware -VMName $VmName `
                 -EnableSecureBoot On `
                 -SecureBootTemplate 'MicrosoftWindows' `
                 -BootOrder $dvd, $hdd

  # vTPM under the local UntrustedGuardian.
  $owner = Get-HgsGuardian -Name 'UntrustedGuardian'
  $kp    = New-HgsKeyProtector -Owner $owner -AllowUntrustedRoot
  Set-VMKeyProtector -VMName $VmName -KeyProtector $kp.RawData
  Enable-VMTPM -VMName $VmName

  Set-VM -Name $VmName -EnhancedSessionTransportType HvSocket
}

Write-Host ""
Write-Host "=== VM ==="
Get-VM -Name $VmName | Format-List Name,State,MemoryStartup,ProcessorCount
Get-VMFirmware -VMName $VmName | Format-List SecureBoot,SecureBootTemplate,BootOrder
Get-VMDvdDrive -VMName $VmName | Format-Table Path,ControllerLocation -AutoSize

Write-Host ""
Write-Host "Credentials baked into VM:"
Write-Host "  Username : $Username"
Write-Host "  Password : $Password"
Write-Host ""
Write-Host "Start it with:"
Write-Host "    powershell -File scripts\start-win-hyperv.ps1"
