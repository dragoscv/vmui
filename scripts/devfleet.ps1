#requires -version 7
<#
.SYNOPSIS
  Manage the development fleet: per-user workstations and per-project servers.

.DESCRIPTION
  Two kinds of machine, deliberately separated:

    workstation  one per PERSON (dragos-dev, mihai-dev). Reached over RDP via
                 Tailscale. Runs VS Code as a client; holds no project code.
                 Windows 11 Pro allows only ONE interactive RDP session per
                 machine, which is why this cannot be a single shared box.

    project      one per PROJECT (brivio-dev). Holds the repo and runs the
                 SSH/tunnel server. Several people connect to the same one and
                 therefore see the same working tree in real time. A person can
                 be given access to several project servers.

  Why the code lives on the project server and not on each workstation: the
  point is that everyone edits the SAME tree. Cloning per workstation would
  turn that into a git-sync problem.

  Why no dev container: measured on this host, a Windows bind mount into a
  container runs at 1285 files/s against 68885 files/s native -- 53x slower.
  brivio alone holds 656938 entries, so pnpm/turbo would crawl. The VM is
  already a stronger isolation boundary than a container.

.EXAMPLE
  devfleet.ps1 -List
  devfleet.ps1 -Rename brivio -To mihai-dev
  devfleet.ps1 -NewProject brivio-dev -SizeGB 200 -MemoryGB 32
#>
[CmdletBinding(DefaultParameterSetName = 'List')]
param(
    [Parameter(ParameterSetName = 'List')]
    [switch]$List,

    [Parameter(Mandatory, ParameterSetName = 'Rename')]
    [string]$Rename,
    [Parameter(Mandatory, ParameterSetName = 'Rename')]
    [string]$To,

    [Parameter(Mandatory, ParameterSetName = 'NewProject')]
    [string]$NewProject,
    [Parameter(ParameterSetName = 'NewProject')]
    [int]$SizeGB = 200,
    [Parameter(ParameterSetName = 'NewProject')]
    [int]$MemoryGB = 32,
    [Parameter(ParameterSetName = 'NewProject')]
    [int]$Cpu = 12,
    [Parameter(ParameterSetName = 'NewProject')]
    [string]$FromTemplate,

    # E: is the development SSD (CT2000P3PSSD8). Do NOT default to H: -- it has
    # the most free space but is a WD Elements external HDD, and a dev VM on
    # spinning rust makes every build crawl.
    [string]$DiskRoot = 'E:\Hyper-V'
)
$ErrorActionPreference = 'Stop'

function Assert-SsdPath([string]$path) {
    $letter = $path.Substring(0, 1)
    $media = (Get-PhysicalDisk | Where-Object {
            (Get-Partition -DiskNumber $_.DeviceId -ErrorAction SilentlyContinue |
            Where-Object DriveLetter).DriveLetter -contains $letter
        }).MediaType

    if ($media -eq 'HDD') {
        Write-Host "  ${letter}: is an HDD. A dev VM there would be unusably slow." -ForegroundColor Red
        Write-Host '  Pass -DiskRoot with an SSD path, or accept the default E:\Hyper-V.' -ForegroundColor Red
        exit 1
    }
    Write-Host "  disk: ${letter}: [$media]" -ForegroundColor DarkGray
}

# Machines are classified by name, so the convention is load-bearing:
#   *-dev that is a person   -> workstation
#   <project>-dev            -> project server
$Workstations = @('dragos-dev', 'mihai-dev')

function Get-Kind([string]$name) {
    if ($name -in $Workstations) { 'workstation' } else { 'project' }
}

function Show-Fleet {
    $ts = 'C:\Program Files\Tailscale\tailscale.exe'
    $tsStatus = if (Test-Path $ts) { & $ts status 2>&1 } else { @() }

    Write-Host ''
    Write-Host '  fleet' -ForegroundColor Cyan
    Write-Host ('  ' + ('-' * 74))
    Write-Host ("  {0,-14} {1,-12} {2,-9} {3,4} {4,5}  {5}" -f 'machine', 'kind', 'state', 'RAM', 'vCPU', 'tailscale')

    foreach ($vm in Get-VM | Sort-Object Name) {
        $kind = Get-Kind $vm.Name
        $tsLine = @($tsStatus | Where-Object { $_ -match "\s$($vm.Name)\s" }) | Select-Object -First 1
        $tsIp = if ($tsLine -match '^(\d+\.\d+\.\d+\.\d+)') { $Matches[1] } else { '-' }
        if ($tsLine -match 'offline') { $tsIp += ' (offline)' }

        Write-Host ("  {0,-14} {1,-12} {2,-9} {3,3}G {4,5}  {5}" -f `
                $vm.Name, $kind, $vm.State, [math]::Round($vm.MemoryStartup / 1GB), $vm.ProcessorCount, $tsIp) `
            -ForegroundColor $(if ($vm.State -eq 'Running') { 'Green' } else { 'Gray' })
    }

    $used = (Get-VM | Measure-Object -Property MemoryStartup -Sum).Sum / 1GB
    $total = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB
    Write-Host ''
    Write-Host ("  RAM committed to VMs: {0} GB of {1} GB ({2} GB left for the host)" -f `
            [math]::Round($used), [math]::Round($total), [math]::Round($total - $used))
}

switch ($PSCmdlet.ParameterSetName) {

    'List' { Show-Fleet }

    'Rename' {
        $vm = Get-VM -Name $Rename -ErrorAction SilentlyContinue
        if (-not $vm) { Write-Host "  no such VM: $Rename" -ForegroundColor Red; exit 1 }
        if ($vm.State -ne 'Off') { Write-Host "  $Rename is $($vm.State); stop it first" -ForegroundColor Red; exit 1 }
        if (Get-VM -Name $To -ErrorAction SilentlyContinue) {
            Write-Host "  $To already exists" -ForegroundColor Red; exit 1
        }

        # Rename the VM only. Moving its VHD is a separate, slower decision and
        # a stale path is harmless -- Hyper-V tracks the file, not the folder.
        Rename-VM -VM $vm -NewName $To
        Write-Host "  renamed $Rename -> $To" -ForegroundColor Green
        Write-Host "  disk still at: $((Get-VHD -VMId $vm.Id).Path)" -ForegroundColor DarkGray
        Write-Host ''
        Write-Host '  Inside the guest you still need to:' -ForegroundColor Cyan
        Write-Host "    Rename-Computer -NewName $To -Restart"
        Write-Host '    tailscale login'
    }

    'NewProject' {
        if (Get-VM -Name $NewProject -ErrorAction SilentlyContinue) {
            Write-Host "  $NewProject already exists" -ForegroundColor Red; exit 1
        }

        Assert-SsdPath $DiskRoot

        $dir = Join-Path $DiskRoot $NewProject
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $vhd = Join-Path $dir "$NewProject.vhdx"

        if ($FromTemplate) {
            if (-not (Test-Path $FromTemplate)) {
                Write-Host "  no such template: $FromTemplate" -ForegroundColor Red; exit 1
            }
            # A differencing disk costs only its delta from the parent, so the
            # second and later machines are nearly free in disk terms.
            New-VHD -Path $vhd -ParentPath $FromTemplate -Differencing | Out-Null
            Write-Host "  created differencing disk from $(Split-Path $FromTemplate -Leaf)" -ForegroundColor Green
        }
        else {
            New-VHD -Path $vhd -SizeBytes ($SizeGB * 1GB) -Dynamic | Out-Null
            Write-Host "  created empty $SizeGB GB dynamic disk" -ForegroundColor Green
        }

        $sw = (Get-VMSwitch | Where-Object { $_.SwitchType -eq 'External' } | Select-Object -First 1).Name
        New-VM -Name $NewProject -MemoryStartupBytes ($MemoryGB * 1GB) -Generation 2 `
            -VHDPath $vhd -SwitchName $sw -Path $DiskRoot | Out-Null
        # Automatic checkpoints turn the disk into an .avhdx chain on first
        # boot, which slows I/O and complicates moving the machine later.
        Set-VM -Name $NewProject -ProcessorCount $Cpu `
            -AutomaticStartAction StartIfRunning -AutomaticStopAction Save `
            -AutomaticCheckpointsEnabled $false
        Set-VMMemory -VMName $NewProject -DynamicMemoryEnabled $false

        Write-Host "  created VM ${NewProject}: $MemoryGB GB, $Cpu vCPU, switch '$sw'" -ForegroundColor Green
        Write-Host ''
        Write-Host '  next:' -ForegroundColor Cyan
        Write-Host '    1. install Windows (or attach a sysprepped template)'
        Write-Host '    2. tailscale login'
        Write-Host '    3. enable sshd, install VS Code Server'
        Write-Host '    4. clone the repo'
    }
}
