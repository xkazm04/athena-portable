# scripts/package-desktop.ps1
# Build the Athena desktop installer for Windows, install it, run it, remove it. One command.
#
#   powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1 -Remote          # ARM64 on a GitHub ARM runner
#   powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1 -Publish         # + attach to a GitHub Release
#   powershell -ExecutionPolicy Bypass -File scripts\package-desktop.ps1 -SkipBuild -Installer <setup.exe>
#
# Stages (each prints PASS or FAIL; the first FAIL stops the run and the exit code is 1):
#   preflight -> install deps -> freeze the daemon -> build the NSIS installer -> artifact checks
#   -> silent install -> files in place -> launch with ATHENA_SMOKE_DAEMON -> no orphan daemon
#   -> silent uninstall -> report (build\installer\report.json + SHA256SUMS.txt)
#
# The sidecar (a PyInstaller binary) cannot be cross-built, so a build targets the architecture of
# the machine it runs on: x64 on this PC, arm64 on an ARM PC or on the windows-11-arm runner that
# -Remote dispatches (.github/workflows/desktop-installer.yml). The smoke runs against a scratch
# data folder (ATHENA_DATA_DIR / ATHENA_STORE), never the person's own brain.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads a script without a BOM as cp1252.

param(
    [ValidateSet('auto', 'x64', 'arm64')]
    [string]$Arch = 'auto',
    # Run the whole thing on a GitHub-hosted runner of that architecture and download the result.
    [switch]$Remote,
    # After every stage passed, attach the installer + checksums to a GitHub Release (opt-in).
    [switch]$Publish,
    [string]$Tag,
    # Test an installer that already exists instead of building one.
    [switch]$SkipBuild,
    [string]$Installer,
    # Leave the app installed at the end (default: uninstall it).
    [switch]$KeepInstalled,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Desktop = Join-Path $Root 'apps\desktop'
$Tauri = Join-Path $Desktop 'src-tauri'
if (-not $OutDir) { $OutDir = Join-Path $Root 'build\installer' }
$Product = 'Athena'
$script:steps = @()
$script:failed = $false

function Write-Stage([string]$name) { Write-Host "`n--- $name ---" -ForegroundColor Yellow }

# Run a stage; record it; stop the run at the first failure.
function Step([string]$Name, [scriptblock]$Block) {
    if ($script:failed) { return }
    Write-Host "  [$Name] " -NoNewline
    try {
        $detail = & $Block
        if ($detail -is [array]) { $detail = $detail[-1] }
        Write-Host 'PASS' -ForegroundColor Green -NoNewline
        if ($detail) { Write-Host "  $detail" -NoNewline }
        Write-Host ''
        $script:steps += [pscustomobject]@{ name = $Name; ok = $true; detail = "$detail" }
    }
    catch {
        Write-Host "FAIL: $_" -ForegroundColor Red
        $script:steps += [pscustomobject]@{ name = $Name; ok = $false; detail = "$_" }
        $script:failed = $true
    }
}

# Run a native command; throw on a non-zero exit. Output streams to the console.
function Run([string]$Exe, [string[]]$ArgList, [string]$Dir = $Root) {
    Push-Location $Dir
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Exe @ArgList
        $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $prev; Pop-Location }
    if ($code -ne 0) { throw "$Exe $($ArgList -join ' ') exited with code $code" }
}

function Need([string]$Command, [string]$Fix) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "$Command is not installed. $Fix" }
}

function HostArch {
    $a = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    if ($a -eq 'Arm64') { return 'arm64' }
    return 'x64'
}

function Finish([int]$Code) {
    $report = [ordered]@{
        arch      = $script:target
        installer = $script:installerPath
        sizeMB    = $script:sizeMB
        sha256    = $script:sha
        ok        = (-not $script:failed)
        steps     = $script:steps
    }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $report | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $OutDir 'report.json') -Encoding UTF8
    if ($script:failed) { Write-Host "`nFAILED. See $OutDir\report.json" -ForegroundColor Red }
    else { Write-Host "`nALL STAGES PASSED ($($script:target))  $($script:installerPath)" -ForegroundColor Green }
    exit $Code
}

$script:target = $Arch
$script:installerPath = $null
$script:sizeMB = $null
$script:sha = $null
$script:installedByUs = $false

Write-Host "`n=== Athena desktop installer ===" -ForegroundColor Cyan

# ------------------------------------------------------------------------------------------------
# Remote: dispatch the workflow on a GitHub runner of the wanted architecture, then download.
# ------------------------------------------------------------------------------------------------
if ($Remote) {
    $want = if ($Arch -eq 'auto') { 'arm64' } else { $Arch }
    $script:target = $want
    Write-Stage "Remote build ($want)"
    Step 'gh-ready' {
        Need 'gh' 'Install the GitHub CLI and run: gh auth login'
        Run 'gh' @('auth', 'status')
    }
    $runId = $null
    Step 'workflow-on-origin' {
        Run 'gh' @('workflow', 'view', 'desktop-installer.yml')
    }
    Step 'dispatch' {
        $before = (& gh run list --workflow desktop-installer.yml --limit 1 --json databaseId --jq '.[0].databaseId') 2>$null
        $pub = if ($Publish) { 'true' } else { 'false' }
        Run 'gh' @('workflow', 'run', 'desktop-installer.yml', '-f', "arch=$want", '-f', "publish=$pub", '-f', "tag=$Tag")
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 4
            $id = (& gh run list --workflow desktop-installer.yml --limit 1 --json databaseId --jq '.[0].databaseId') 2>$null
            if ($id -and "$id" -ne "$before") { $script:runId = "$id"; return "run $id" }
        }
        throw 'the dispatched run never appeared'
    }
    Step 'wait-for-run' {
        Run 'gh' @('run', 'watch', $script:runId, '--exit-status')
    }
    Step 'download' {
        New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
        Run 'gh' @('run', 'download', $script:runId, '-D', $OutDir)
        $found = Get-ChildItem -Path $OutDir -Recurse -Filter '*-setup.exe' | Select-Object -First 1
        if (-not $found) { throw "no installer in the downloaded artifacts under $OutDir" }
        $script:installerPath = $found.FullName
        $script:sizeMB = [math]::Round($found.Length / 1MB, 1)
        $script:sha = (Get-FileHash $found.FullName -Algorithm SHA256).Hash.ToLower()
        $found.FullName
    }
    Finish ([int]$script:failed)
}

# ------------------------------------------------------------------------------------------------
# Local build + test, for the architecture of this machine.
# ------------------------------------------------------------------------------------------------
$hostArch = HostArch
if ($Arch -eq 'auto') { $script:target = $hostArch } else { $script:target = $Arch }

Write-Stage "Preflight (host $hostArch, target $($script:target))"
Step 'target-matches-host' {
    if ($script:target -ne $hostArch) {
        throw "this PC is $hostArch and the daemon (PyInstaller) cannot be cross-built, so it cannot make an $($script:target) installer. Re-run with -Remote to build on a GitHub $($script:target) runner."
    }
    "$hostArch"
}
$installDir = Join-Path $env:LOCALAPPDATA $Product
Step 'no-existing-install' {
    # Never overwrite or remove a real install: the test installs to the same per-user folder.
    if (Test-Path (Join-Path $installDir 'uninstall.exe')) {
        throw "Athena is already installed at $installDir. Uninstall it first (this test installs and removes it)."
    }
    'clean'
}
if (-not $SkipBuild -and -not $Installer) {
    Step 'tools' {
        Need 'node' 'Install Node 24 from https://nodejs.org'
        Need 'pnpm' 'Run: corepack enable'
        Need 'cargo' 'Install Rust from https://rustup.rs'
        Need 'rustc' 'Install Rust from https://rustup.rs'
        Need 'uv' 'Install uv: https://docs.astral.sh/uv/'
        $rustHost = (& rustc -vV | Select-String '^host:').ToString().Split(':')[1].Trim()
        $wantHost = if ($script:target -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
        if ($rustHost -ne $wantHost) { throw "rustc targets $rustHost, expected $wantHost. Run: rustup default stable-$wantHost" }
        $rustHost
    }

    Write-Stage 'Build'
    Step 'install-js-deps' { Run 'pnpm' @('install', '--frozen-lockfile') }
    # No `uv sync`: it is exact and would strip the dev tools from the checkout's venv. `uv run --extra`
    # below installs what the freeze needs and removes nothing.
    Step 'freeze-daemon' {
        Run 'uv' @('run', '--extra', 'build', '--extra', 'voice-fx', 'python', 'scripts/build-sidecar.py', '--clean')
        $bin = Get-ChildItem (Join-Path $Tauri 'binaries') -Filter 'athena-daemon-*.exe' | Select-Object -First 1
        if (-not $bin) { throw 'build-sidecar.py wrote no athena-daemon-<triple>.exe' }
        "$($bin.Name) ($([math]::Round($bin.Length / 1MB, 1)) MB)"
    }
    Step 'build-installer' {
        # beforeBuildCommand builds the frontend; the bundle config adds the daemon as externalBin.
        Run 'pnpm' @('tauri', 'build', '--bundles', 'nsis', '--config', 'src-tauri/tauri.bundle.conf.json') $Desktop
    }
}

Write-Stage 'Installer artifact'
Step 'find-installer' {
    if ($Installer) { $found = Get-Item $Installer }
    else {
        $found = Get-ChildItem (Join-Path $Tauri 'target\release\bundle\nsis') -Filter "*$($script:target)-setup.exe" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
    }
    if (-not $found) { throw "no *$($script:target)-setup.exe under src-tauri\target\release\bundle\nsis" }
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    $dest = Join-Path $OutDir $found.Name
    if ($found.FullName -ne $dest) { Copy-Item $found.FullName $dest -Force }
    $script:installerPath = $dest
    $script:sizeMB = [math]::Round($found.Length / 1MB, 1)
    $script:sha = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
    "$($found.Name)  $($script:sizeMB) MB"
}
Step 'size-floor' {
    # A frozen daemon alone is tens of MB: a smaller installer was built without it.
    if ($script:sizeMB -lt 25) { throw "installer is only $($script:sizeMB) MB; the daemon sidecar is probably missing" }
    "$($script:sizeMB) MB"
}
Step 'checksum' {
    $line = "$($script:sha)  $(Split-Path -Leaf $script:installerPath)"
    Set-Content -Path (Join-Path $OutDir 'SHA256SUMS.txt') -Value $line -Encoding ASCII
    $script:sha
}

Write-Stage 'Install'
Step 'silent-install' {
    $p = Start-Process -FilePath $script:installerPath -ArgumentList '/S' -PassThru -Wait
    $script:installedByUs = $true
    if ($p.ExitCode -ne 0) { throw "installer exited with code $($p.ExitCode)" }
    Start-Sleep -Seconds 2
}
$exe = $null
Step 'files-in-place' {
    if (-not (Test-Path $installDir)) { throw "nothing at $installDir" }
    $script:exe = Get-ChildItem $installDir -Filter '*.exe' |
        Where-Object { $_.Name -notmatch '^(uninstall|athena-daemon)' } | Select-Object -First 1
    if (-not $script:exe) { throw "no application exe in $installDir" }
    if (-not (Test-Path (Join-Path $installDir 'uninstall.exe'))) { throw 'uninstall.exe is missing' }
    if (-not (Test-Path (Join-Path $installDir 'athena-daemon.exe'))) { throw 'athena-daemon.exe is not beside the app: the shell would fall back to uv, which a user does not have' }
    $script:exe.Name
}
Step 'uninstall-entry' {
    $key = Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
        Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).DisplayName -eq $Product } | Select-Object -First 1
    if (-not $key) { throw "no Apps & features entry named $Product" }
    'registered'
}

Write-Stage 'Run'
$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("athena-installer-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
Step 'launch-and-daemon-ready' {
    New-Item -ItemType Directory -Force -Path $scratch | Out-Null
    $out = Join-Path $scratch 'smoke.json'
    $saved = @{}
    $vars = @{
        ATHENA_SMOKE_DAEMON = '1'
        ATHENA_SMOKE_OUT    = $out
        ATHENA_DATA_DIR     = (Join-Path $scratch 'data')
        ATHENA_STORE        = (Join-Path $scratch 'store.sqlite')
    }
    foreach ($k in $vars.Keys) { $saved[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $vars[$k]) }
    try {
        $p = Start-Process -FilePath $script:exe.FullName -PassThru
        if (-not $p.WaitForExit(150000)) {
            & taskkill /PID $p.Id /T /F | Out-Null
            throw 'the app did not finish its smoke in 150 s'
        }
    }
    finally { foreach ($k in $vars.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }
    if (-not (Test-Path $out)) { throw "the app exited ($($p.ExitCode)) without writing its smoke line" }
    $line = Get-Content $out -Raw | ConvertFrom-Json
    if (-not $line.ok) { throw "daemon $($line.daemon): $($line.reason)" }
    if ($line.source -ne 'sidecar') { throw "daemon source was '$($line.source)', not the frozen sidecar" }
    if ($p.ExitCode -ne 0) { throw "smoke said ok but the app exited $($p.ExitCode)" }
    "daemon ready via $($line.source) at $($line.url)"
}
Step 'no-orphan-daemon' {
    Start-Sleep -Seconds 3
    $left = @(Get-Process -Name 'athena-daemon' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) })
    if ($left.Count -gt 0) {
        $left | Stop-Process -Force
        throw "$($left.Count) athena-daemon process(es) outlived the app"
    }
    'none left'
}

if (-not $KeepInstalled) {
    Write-Stage 'Uninstall'
    Step 'silent-uninstall' {
        $p = Start-Process -FilePath (Join-Path $installDir 'uninstall.exe') -ArgumentList '/S' -PassThru -Wait
        if ($p.ExitCode -ne 0) { throw "uninstaller exited with code $($p.ExitCode)" }
        # The NSIS uninstaller re-launches itself from %TEMP%, so it can return before it is done.
        for ($i = 0; $i -lt 30; $i++) {
            if (-not (Test-Path (Join-Path $installDir '*.exe'))) { return 'removed' }
            Start-Sleep -Seconds 1
        }
        throw "files remain in $installDir after uninstall"
    }
}
Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue
if ($script:failed -and $script:installedByUs -and -not $KeepInstalled) {
    # A failed run must not leave an install behind for the next run's guard to trip on.
    $un = Join-Path $installDir 'uninstall.exe'
    if (Test-Path $un) { Start-Process -FilePath $un -ArgumentList '/S' -Wait | Out-Null }
    Get-Process -Name 'athena-daemon' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($installDir, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
}

# ------------------------------------------------------------------------------------------------
# Publish (opt-in): only after every stage passed.
# ------------------------------------------------------------------------------------------------
if ($Publish -and -not $script:failed) {
    Write-Stage 'Publish'
    Step 'github-release' {
        Need 'gh' 'Install the GitHub CLI and run: gh auth login'
        $ver = ((Get-Content (Join-Path $Tauri 'tauri.conf.json') -Raw | ConvertFrom-Json).version)
        $tagName = if ($Tag) { $Tag } else { "desktop-v$ver" }
        $assets = @($script:installerPath, (Join-Path $OutDir 'SHA256SUMS.txt'))
        & gh release view $tagName *> $null
        if ($LASTEXITCODE -eq 0) { Run 'gh' (@('release', 'upload', $tagName, '--clobber') + $assets) }
        else { Run 'gh' (@('release', 'create', $tagName, '--prerelease', '--title', "Athena desktop $ver", '--notes', 'Unsigned Windows installer. Windows SmartScreen will warn: choose More info, then Run anyway. Verify the download against SHA256SUMS.txt.') + $assets) }
        $tagName
    }
}

Finish ([int]$script:failed)
