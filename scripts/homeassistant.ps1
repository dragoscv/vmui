#requires -version 7
<#
.SYNOPSIS
  Build and operate the Home Assistant OS appliance VM on Hyper-V.

.DESCRIPTION
  Home Assistant runs as a Hyper-V appliance rather than a container because
  only Home Assistant OS ships the Supervisor, and the Supervisor is what
  provides add-ons (Tailscale, Mosquitto, Zigbee2MQTT, ESPHome) and the
  automatic pre-update backups. The `homeassistant/home-assistant` Docker
  image is "Container mode": no Supervisor, no add-ons, no UI updates.

  Three things differ from every other VM in this repo, and each one is fatal
  if got wrong:

    Secure Boot MUST be Off. HAOS is signed by neither the MicrosoftWindows
    nor the MicrosoftUEFICertificateAuthority template, so a Gen2 VM with
    Secure Boot on halts at the firmware screen with no useful message.

    No vTPM. HAOS does not use one, and Enable-VMTPM on a guest that never
    provisions it only adds a key protector to lose track of.

    External switch, not Default Switch. Smart-device discovery (mDNS/Bonjour,
    SSDP, and raw UDP broadcast used by Tuya, Shelly, Sonoff, Hue, Chromecast)
    does not survive NAT. On Default Switch the integrations simply find
    nothing, and report no error while doing it -- the worst failure shape.

  The image is a prebuilt VHDX, so there is no ISO, no unattend file and no
  oscdimg step. It IS downloaded from the internet and booted with access to
  the LAN, so unlike the other scripts here it verifies a SHA-256 before use.

.EXAMPLE
  homeassistant.ps1 -Build
  homeassistant.ps1 -Build -Latest          # resolve newest HAOS from GitHub
  homeassistant.ps1 -Status
  homeassistant.ps1 -Start
  homeassistant.ps1 -Stop
#>
[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')]
    [switch]$Status,

    [Parameter(Mandatory, ParameterSetName = 'Build')]
    [switch]$Build,
    # Resolve the newest stable release (and its checksum) from the GitHub API
    # instead of using the pinned pair below.
    [Parameter(ParameterSetName = 'Build')]
    [switch]$Latest,
    [Parameter(ParameterSetName = 'Build')]
    [switch]$Force,

    [Parameter(Mandatory, ParameterSetName = 'Start')]
    [switch]$Start,
    [Parameter(Mandatory, ParameterSetName = 'Stop')]
    [switch]$Stop,
    [Parameter(Mandatory, ParameterSetName = 'Remove')]
    [switch]$Remove,

    # Enable root SSH on port 22222 (the HAOS "developer" SSH). The port-22
    # SSH add-on runs in a container with no Docker socket, so it cannot exec
    # into other add-ons -- 22222 is the only way to run `tailscale` inside
    # the Tailscale add-on, read a crashed add-on's full log, or repair the
    # OS. HAOS wants the key on a USB stick labelled CONFIG; on Hyper-V that
    # is a tiny FAT VHDX attached as a second disk, then `ha os import`.
    [Parameter(Mandatory, ParameterSetName = 'EnableHostSsh')]
    [switch]$EnableHostSsh,
    [Parameter(ParameterSetName = 'EnableHostSsh')]
    [string]$PublicKeyPath = (Join-Path $HOME '.ssh\id_ed25519.pub'),

    [string]$VmName = 'homeassistant',
    [string]$DiskRoot = 'E:\Hyper-V',
    [int]$MemoryGB = 6,
    [int]$Cpu = 4,
    [int]$DiskGB = 64,
    # The External switch is the only one with real LAN access. Default Switch
    # and vmnet are Internal (NAT) and break device discovery.
    [string]$SwitchName = 'Windows 11 Enterprise'
)
$ErrorActionPreference = 'Stop'

# Pinned known-good release. Both values come from the GitHub release API's
# asset `digest` field, so they can be re-derived: -Latest does exactly that.
$PinnedVersion = '18.2'
$PinnedSha256 = '722f9a106ef1eb46c0087cf9f447e11c7187bcd755e4410a42184239592d3f12'

$VmDir = Join-Path $DiskRoot $VmName
$CacheDir = Join-Path $DiskRoot '_images'
$VhdPath = Join-Path $VmDir "$VmName.vhdx"

function Write-Step($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  $msg" -ForegroundColor Red }

function Assert-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not ([Security.Principal.WindowsPrincipal]$id).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Fail 'Hyper-V VM creation needs an elevated shell.'
        Write-Fail 'Re-run from an admin pwsh, or use the "ha: build VM" task.'
        exit 1
    }
}

# E: is the development SSD. H: has more free space but is a WD Elements
# external HDD; Home Assistant writes its recorder database continuously and
# would be miserable there.
function Assert-SsdPath([string]$path) {
    $letter = $path.Substring(0, 1)
    $media = (Get-PhysicalDisk | Where-Object {
            (Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue |
            Where-Object DriveLetter).DriveLetter -contains $letter
        }).MediaType
    if ($media -eq 'HDD') {
        Write-Fail "${letter}: is an HDD; the recorder database would crawl there."
        exit 1
    }
}

function Resolve-Release {
    if (-not $Latest) {
        return @{ Version = $PinnedVersion; Sha256 = $PinnedSha256 }
    }
    Write-Step 'resolving newest Home Assistant OS release...'
    $rel = Invoke-RestMethod -UseBasicParsing `
        -Uri 'https://api.github.com/repos/home-assistant/operating-system/releases/latest'
    $asset = $rel.assets | Where-Object { $_.name -like 'haos_ova-*.vhdx.zip' } | Select-Object -First 1
    if (-not $asset) { Write-Fail 'no vhdx asset in the latest release'; exit 1 }
    # `digest` is "sha256:<hex>"; GitHub computes it, so it is not a checksum
    # the download itself could forge.
    $sha = ($asset.digest -split ':')[-1]
    Write-Ok "latest is $($rel.tag_name) (pinned default is $PinnedVersion)"
    return @{ Version = $rel.tag_name; Sha256 = $sha }
}

function Get-HaosVhdx([string]$version, [string]$sha256) {
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
    $zip = Join-Path $CacheDir "haos_ova-$version.vhdx.zip"
    $url = "https://github.com/home-assistant/operating-system/releases/download/$version/haos_ova-$version.vhdx.zip"

    if (Test-Path $zip) {
        Write-Step "cached archive found, verifying..."
    }
    else {
        Write-Step "downloading HAOS $version (~590 MB)..."
        # Invoke-WebRequest's progress bar costs more time than the transfer on
        # a fast link; disabling it is a measured ~3x speedup on large files.
        $prev = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip }
        finally { $ProgressPreference = $prev }
    }

    $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
    if ($actual -ne $sha256.ToLower()) {
        Write-Fail 'SHA-256 mismatch -- refusing to boot this image.'
        Write-Fail "  expected $sha256"
        Write-Fail "  actual   $actual"
        Write-Fail "Delete $zip and retry, or pass -Latest to re-resolve."
        exit 1
    }
    Write-Ok "checksum verified ($($actual.Substring(0,16))...)"

    New-Item -ItemType Directory -Force -Path $VmDir | Out-Null
    Write-Step 'expanding image...'
    $staging = Join-Path $CacheDir "expand-$version"
    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
    Expand-Archive -Path $zip -DestinationPath $staging -Force
    $src = Get-ChildItem -Path $staging -Filter *.vhdx -Recurse | Select-Object -First 1
    if (-not $src) { Write-Fail 'no .vhdx inside the archive'; exit 1 }
    Move-Item -Path $src.FullName -Destination $VhdPath -Force
    Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
    Write-Ok "disk at $VhdPath"
}

function New-HaVm {
    Assert-Elevated
    Assert-SsdPath $DiskRoot

    if (Get-VM -Name $VmName -ErrorAction SilentlyContinue) {
        if (-not $Force) {
            Write-Fail "$VmName already exists. Pass -Force to rebuild (DESTROYS its data)."
            exit 1
        }
        Write-Warn "removing existing $VmName..."
        Stop-VM -Name $VmName -TurnOff -Force -ErrorAction SilentlyContinue
        Remove-VM -Name $VmName -Force
        Remove-Item -Force $VhdPath -ErrorAction SilentlyContinue
    }

    if (-not (Get-VMSwitch -Name $SwitchName -ErrorAction SilentlyContinue)) {
        Write-Fail "no such switch: $SwitchName"
        Write-Fail 'Available External switches:'
        Get-VMSwitch | Where-Object SwitchType -eq 'External' | ForEach-Object { Write-Fail "  $($_.Name)" }
        exit 1
    }

    $rel = Resolve-Release
    Get-HaosVhdx -version $rel.Version -sha256 $rel.Sha256

    # The shipped image is 32 GB. The recorder database plus a few add-ons and
    # the automatic backups outgrow that; expanding now avoids a later resize,
    # which requires the VM to be Off.
    $current = (Get-VHD -Path $VhdPath).Size
    if ($current -lt ($DiskGB * 1GB)) {
        Write-Step "expanding disk to $DiskGB GB..."
        Resize-VHD -Path $VhdPath -SizeBytes ($DiskGB * 1GB)
        # HAOS grows its own data partition on boot, so no guest-side work.
    }

    Write-Step "creating VM..."
    New-VM -Name $VmName -Generation 2 -MemoryStartupBytes ($MemoryGB * 1GB) `
        -VHDPath $VhdPath -SwitchName $SwitchName -Path $DiskRoot | Out-Null

    # Secure Boot Off is the single most common reason HAOS will not boot on
    # Hyper-V. It is not signed for either Microsoft template.
    Set-VMFirmware -VMName $VmName -EnableSecureBoot Off

    # An imported disk defaults to booting Network first, which PXE-boots into
    # nothing instead of starting the OS.
    $hdd = Get-VMHardDiskDrive -VMName $VmName
    Set-VMFirmware -VMName $VmName -FirstBootDevice $hdd

    Set-VM -Name $VmName -ProcessorCount $Cpu `
        -AutomaticCheckpointsEnabled $false `
        -CheckpointType Production `
        -AutomaticStartAction Start -AutomaticStartDelay 30 `
        -AutomaticStopAction ShutDown

    # Dynamic memory makes the JVM-less but allocation-heavy Python process
    # thrash under ballooning; the fleet convention is static.
    Set-VMMemory -VMName $VmName -DynamicMemoryEnabled $false

    # Home Assistant is a network appliance: it answers mDNS and may later run
    # a Tailscale subnet router, both of which need to emit frames whose source
    # MAC is not the adapter's own.
    Set-VMNetworkAdapter -VMName $VmName -MacAddressSpoofing On

    Write-Ok "created $VmName -- $MemoryGB GB, $Cpu vCPU, $DiskGB GB, switch '$SwitchName'"
    Write-Step 'starting...'
    Start-VM -Name $VmName

    $mac = (Get-VMNetworkAdapter -VMName $VmName).MacAddress
    Write-Host ''
    Write-Ok "MAC $mac -- reserve this in the router for a stable LAN address"
    Write-Host ''
    Write-Host '  Home Assistant takes 3-5 minutes to first-boot. Then:' -ForegroundColor Cyan
    Write-Host '    scripts\homeassistant.ps1 -Status      # find its IP'
    # HAOS 18 serves the UI on port 80. Every older guide says 8123; probing
    # that port fails while the UI works, which looks like a crashed VM.
    Write-Host '    http://homeassistant.local             # onboarding (port 80, not 8123)'
}

function Get-HaIp {
    $vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
    if (-not $vm -or $vm.State -ne 'Running') { return $null }
    # KVP is the cheapest way to read a guest address with no credentials, but
    # HAOS does not run the Hyper-V KVP daemon, so fall back to the ARP table
    # keyed on the adapter MAC.
    $mac = (Get-VMNetworkAdapter -VMName $VmName).MacAddress
    $pretty = ($mac -replace '(..)(?=.)', '$1-').ToLower()
    $entry = Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.LinkLayerAddress -eq $pretty -and $_.State -ne 'Unreachable' }
    if ($entry) { return $entry.IPAddress | Select-Object -First 1 }
    # mDNS: HAOS always publishes homeassistant.local
    try {
        return ([Net.Dns]::GetHostAddresses('homeassistant.local') |
            Where-Object AddressFamily -eq 'InterNetwork' |
            Select-Object -First 1).IPAddressToString
    }
    catch { return $null }
}

function Enable-HostSsh {
    Assert-Elevated
    if (-not (Test-Path $PublicKeyPath)) { Write-Fail "no public key at $PublicKeyPath"; exit 1 }
    $vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
    if (-not $vm -or $vm.State -ne 'Running') { Write-Fail "$VmName must be running"; exit 1 }

    $cfgVhd = Join-Path $VmDir 'config-usb.vhdx'
    if (Get-VMHardDiskDrive -VMName $VmName | Where-Object Path -eq $cfgVhd) {
        Write-Warn 'CONFIG disk already attached; detaching to refresh the key'
        Get-VMHardDiskDrive -VMName $VmName | Where-Object Path -eq $cfgVhd | Remove-VMHardDiskDrive
    }
    Remove-Item -Force $cfgVhd -ErrorAction SilentlyContinue

    Write-Step 'building CONFIG disk...'
    # 64 MB is the practical minimum for a FAT volume Windows will format.
    $disk = New-VHD -Path $cfgVhd -SizeBytes 64MB -Fixed
    $mounted = Mount-VHD -Path $cfgVhd -Passthru
    try {
        $mounted | Initialize-Disk -PartitionStyle MBR -PassThru |
            New-Partition -UseMaximumSize -AssignDriveLetter |
            Format-Volume -FileSystem FAT -NewFileSystemLabel 'CONFIG' -Confirm:$false | Out-Null
        $letter = (Get-Partition -DiskNumber $mounted.DiskNumber | Where-Object DriveLetter).DriveLetter
        # HAOS insists on LF endings and pure ASCII; a CRLF or a UTF-8 BOM
        # makes the key silently unusable.
        $key = (Get-Content $PublicKeyPath -Raw).Trim() -replace "`r`n", "`n"
        [IO.File]::WriteAllText("${letter}:\authorized_keys", $key + "`n", [Text.ASCIIEncoding]::new())
        Write-Ok "authorized_keys written to CONFIG (${letter}:)"
    }
    finally { Dismount-VHD -Path $cfgVhd }

    Add-VMHardDiskDrive -VMName $VmName -Path $cfgVhd
    Write-Ok 'CONFIG disk attached'
    Write-Host ''
    Write-Host '  Now, over the port-22 add-on, import it and reboot the host OS:' -ForegroundColor Cyan
    Write-Host "    ssh root@<ha-ip> 'ha os import && ha host reboot'" -ForegroundColor DarkGray
    Write-Host '  then:  ssh -p 22222 root@<ha-ip>' -ForegroundColor DarkGray
}

function Show-Status {
    $vm = Get-VM -Name $VmName -ErrorAction SilentlyContinue
    Write-Host ''
    if (-not $vm) {
        Write-Warn "$VmName does not exist. Build it with:  homeassistant.ps1 -Build"
        return
    }
    Write-Host '  home assistant' -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * 56))
    Write-Host ("  {0,-12} {1}" -f 'state', $vm.State)
    Write-Host ("  {0,-12} {1} GB / {2} vCPU" -f 'resources', [int]($vm.MemoryStartup / 1GB), $vm.ProcessorCount)
    Write-Host ("  {0,-12} {1}" -f 'switch', (Get-VMNetworkAdapter -VMName $VmName).SwitchName)
    Write-Host ("  {0,-12} {1}" -f 'mac', (Get-VMNetworkAdapter -VMName $VmName).MacAddress)
    Write-Host ("  {0,-12} {1}" -f 'autostart', $vm.AutomaticStartAction)
    Write-Host ("  {0,-12} {1}" -f 'secureboot', (Get-VMFirmware -VMName $VmName).SecureBoot)

    if ($vm.State -eq 'Running') {
        $ip = Get-HaIp
        if ($ip) {
            Write-Host ("  {0,-12} {1}" -f 'address', $ip) -ForegroundColor Green
            # Port 80 on HAOS 18 (the classic 8123 is gone).
            $ok = Test-NetConnection -ComputerName $ip -Port 80 -InformationLevel Quiet -WarningAction SilentlyContinue
            Write-Host ("  {0,-12} {1}" -f 'web ui :80', $(if ($ok) { 'open' } else { 'not answering yet' })) `
                -ForegroundColor $(if ($ok) { 'Green' } else { 'Yellow' })
            Write-Host ''
            Write-Host "  http://${ip}" -ForegroundColor Cyan
            Write-Host '  https://home.dragoscatalin.ro   (tailnet)' -ForegroundColor Cyan
        }
        else {
            Write-Warn 'address not discovered yet (first boot takes 3-5 min)'
        }
    }
    Write-Host ''
}

switch ($PSCmdlet.ParameterSetName) {
    'Build' { New-HaVm }
    'EnableHostSsh' { Enable-HostSsh }
    'Start' { Start-VM -Name $VmName; Write-Ok "$VmName starting"; Show-Status }
    'Stop' {
        # Graceful: the guest flushes the recorder database. TurnOff risks
        # a corrupt SQLite file.
        Stop-VM -Name $VmName
        Write-Ok "$VmName stopped"
    }
    'Remove' {
        Assert-Elevated
        Write-Warn "This DESTROYS the Home Assistant VM and all its data."
        $c = Read-Host '  Type the VM name to confirm'
        if ($c -ne $VmName) { Write-Fail 'aborted'; exit 1 }
        Stop-VM -Name $VmName -TurnOff -Force -ErrorAction SilentlyContinue
        Remove-VM -Name $VmName -Force
        Remove-Item -Recurse -Force $VmDir -ErrorAction SilentlyContinue
        Write-Ok 'removed'
    }
    default { Show-Status }
}
