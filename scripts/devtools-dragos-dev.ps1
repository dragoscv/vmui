# vmui — install the development toolchain for the "dragos-dev" VS Code tunnel host.
#
# Runs over PowerShell Direct. Deliberately avoids `winget` for the heavy
# lifting: winget needs an interactive-ish user context and frequently fails
# with 0x8a15000f / MSSTORE auth errors under PowerShell Direct. Direct vendor
# downloads are boring, scriptable and idempotent.
#
# Installs: Git, Node LTS, pnpm (via corepack), GitHub CLI, PowerShell 7.
# Then registers the VS Code Insiders tunnel as a Windows service and installs
# a baseline extension set.
[CmdletBinding()]
param(
  [string]$VmName      = 'dragos-dev',
  [string]$Username    = 'dragos',
  [string]$Password    = '',
  [string]$TunnelName  = 'dragos-dev',
  [switch]$SkipToolchain,
  [switch]$SkipTunnel,
  [switch]$SkipExtensions
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\lib\guest-credentials.ps1"

if (-not $Password) { $Password = $env:DRAGOS_DEV_PASS }
if (-not $Password) { Write-Error "No password. Set DRAGOS_DEV_PASS in .private/credentials.env."; exit 2 }

$secure = ConvertTo-SecureString $Password -AsPlainText -Force
$cred   = New-Object System.Management.Automation.PSCredential("$VmName\$Username", $secure)

# ---------------------------------------------------------------------------
# 1. Toolchain.
# ---------------------------------------------------------------------------
if (-not $SkipToolchain) {
  Write-Host "[1/3] Installing toolchain (git, node, pnpm, gh, pwsh)..."
  Invoke-Command -VMName $VmName -Credential $cred -ScriptBlock {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference    = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $tmp = 'C:\Windows\Temp\vmui-tools'
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null

    function Install-FromUrl {
      # NOTE: the arg-list parameter must NOT be named $Args -- that is an
      # automatic PowerShell variable and binds as empty inside a function.
      param([string]$Name, [string]$Url, [string]$File, [string[]]$InstallArgs, [string]$ProbeExe)
      if ($ProbeExe -and (Test-Path $ProbeExe)) { Write-Output "  $Name already present"; return }
      $path = Join-Path $tmp $File
      Write-Output "  downloading $Name..."
      Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $path
      Write-Output "  installing $Name..."
      $p = if ($File -like '*.msi') {
        Start-Process msiexec.exe -Wait -PassThru -ArgumentList (@('/i', "`"$path`"") + $InstallArgs)
      } else {
        Start-Process $path -Wait -PassThru -ArgumentList $InstallArgs
      }
      if ($p.ExitCode -ne 0) { Write-Output "  WARN $Name exit=$($p.ExitCode)" }
      Remove-Item $path -Force -ErrorAction SilentlyContinue
    }

    # -- Git for Windows -----------------------------------------------------
    $gitApi = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/git-for-windows/git/releases/latest' `
                                -Headers @{ 'User-Agent' = 'vmui' }
    $gitUrl = ($gitApi.assets | Where-Object { $_.name -match '64-bit\.exe$' } | Select-Object -First 1).browser_download_url
    Install-FromUrl -Name 'Git' -Url $gitUrl -File 'git.exe' -ProbeExe 'C:\Program Files\Git\cmd\git.exe' `
      -InstallArgs @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/CLOSEAPPLICATIONS',
                     '/COMPONENTS=gitlfs,assoc', '/o:PathOption=CmdTools', '/o:SSHOption=OpenSSH')

    # -- Node.js LTS ---------------------------------------------------------
    $nodeIdx = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
    $lts     = $nodeIdx | Where-Object { $_.lts } | Select-Object -First 1
    Install-FromUrl -Name "Node $($lts.version)" `
      -Url "https://nodejs.org/dist/$($lts.version)/node-$($lts.version)-x64.msi" `
      -File 'node.msi' -ProbeExe 'C:\Program Files\nodejs\node.exe' `
      -InstallArgs @('/qn', '/norestart')

    # -- GitHub CLI ----------------------------------------------------------
    $ghApi = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/cli/cli/releases/latest' `
                               -Headers @{ 'User-Agent' = 'vmui' }
    $ghUrl = ($ghApi.assets | Where-Object { $_.name -match 'windows_amd64\.msi$' } | Select-Object -First 1).browser_download_url
    Install-FromUrl -Name 'GitHub CLI' -Url $ghUrl -File 'gh.msi' `
      -ProbeExe 'C:\Program Files\GitHub CLI\gh.exe' -InstallArgs @('/qn', '/norestart')

    # -- PowerShell 7 --------------------------------------------------------
    $psApi = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/PowerShell/PowerShell/releases/latest' `
                               -Headers @{ 'User-Agent' = 'vmui' }
    $psUrl = ($psApi.assets | Where-Object { $_.name -match 'win-x64\.msi$' } | Select-Object -First 1).browser_download_url
    Install-FromUrl -Name 'PowerShell 7' -Url $psUrl -File 'pwsh.msi' `
      -ProbeExe 'C:\Program Files\PowerShell\7\pwsh.exe' `
      -InstallArgs @('/qn', '/norestart', 'ADD_PATH=1', 'ENABLE_PSREMOTING=1')

    # Refresh PATH in this session so corepack is callable immediately.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')

    # -- pnpm via corepack (ships with Node) ---------------------------------
    $corepack = 'C:\Program Files\nodejs\corepack.cmd'
    if (Test-Path $corepack) {
      Write-Output "  enabling corepack + pnpm..."
      & $corepack enable 2>&1 | Out-Null
      & $corepack prepare pnpm@latest --activate 2>&1 | Out-Null
    }

    # -- Disable the Store python.exe stubs; they shadow a real install. -----
    $stub = "$env:LOCALAPPDATA\Microsoft\WindowsApps\python.exe"
    if (Test-Path $stub) {
      $appsPath = "$env:LOCALAPPDATA\Microsoft\WindowsApps"
      $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
      Write-Output "  (Store python stub present at $appsPath - left in place)"
    }

    'toolchain-done'
  } | ForEach-Object { Write-Host "      $_" }
}

# ---------------------------------------------------------------------------
# 2. Tunnel service.
#
# `code-insiders.cmd tunnel service install` registers a per-user service that
# starts at logon. The account is already configured for autologon, so the
# tunnel comes up automatically after a reboot.
# ---------------------------------------------------------------------------
if (-not $SkipTunnel) {
  Write-Host "[2/3] Registering VS Code Insiders tunnel service..."
  Invoke-Command -VMName $VmName -Credential $cred -ArgumentList $TunnelName -ScriptBlock {
    param($TunnelName)
    $ErrorActionPreference = 'Continue'

    $cli = 'C:\Program Files\Microsoft VS Code Insiders\bin\code-insiders.cmd'
    if (-not (Test-Path $cli)) { return "ERROR: $cli not found" }

    # Is the user already authenticated? (populated by `tunnel user login`)
    $out = & $cli tunnel user show 2>&1 | Out-String
    Write-Output "  auth: $($out.Trim())"

    Write-Output "  installing service..."
    $svc = & $cli tunnel service install --accept-server-license-terms --name $TunnelName 2>&1 | Out-String
    Write-Output ($svc.Trim() -split "`n" | Select-Object -Last 6)

    'tunnel-registered'
  } | ForEach-Object { Write-Host "      $_" }
}

# ---------------------------------------------------------------------------
# 3. Baseline extensions.
# ---------------------------------------------------------------------------
if (-not $SkipExtensions) {
  Write-Host "[3/3] Installing baseline extensions..."
  Invoke-Command -VMName $VmName -Credential $cred -ScriptBlock {
    $ErrorActionPreference = 'Continue'
    $cli = 'C:\Program Files\Microsoft VS Code Insiders\bin\code-insiders.cmd'
    if (-not (Test-Path $cli)) { return 'ERROR: code-insiders.cmd missing' }

    # Matches the golden stack: Next.js + TS + Tailwind v4 + Drizzle + Vitest.
    $exts = @(
      'github.copilot',
      'github.copilot-chat',
      'dbaeumer.vscode-eslint',
      'esbenp.prettier-vscode',
      'bradlc.vscode-tailwindcss',
      'ms-vscode.vscode-typescript-next',
      'usernamehw.errorlens',
      'eamodio.gitlens',
      'ms-azuretools.vscode-docker',
      'vitest.explorer',
      'ms-playwright.playwright',
      'yoavbls.pretty-ts-errors',
      'ms-vscode.powershell'
    )
    foreach ($e in $exts) {
      $r = & $cli --install-extension $e --force 2>&1 | Out-String
      if ($r -match 'successfully installed|already installed') { Write-Output "  ok   $e" }
      else { Write-Output "  FAIL $e :: $(($r -split "`n" | Select-Object -Last 1).Trim())" }
    }
    'extensions-done'
  } | ForEach-Object { Write-Host "      $_" }
}

Write-Host ""
Write-Host "=== done ==="
