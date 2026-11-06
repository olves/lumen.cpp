# Builds the Tauri shell (development build, spec 7a) into <Lumen WF>\work\tauri-build:
#   lumen.exe, node.exe (official Node 22 LTS, SHA-256 pinned in scripts\node-manifest.json), app\ (the UI and the core),
#   backend\ (lumen-host.exe and engines, copied from work\electron-dev built by build-portable.ps1; no C# is rebuilt).
#   .\scripts\build-tauri.ps1                      production build (no remote debugging code path)
#   .\scripts\build-tauri.ps1 -Features ui-check   test build: --ui-check may open WebView2's debugging port
#   -NodeOnly                                       only fetch/verify node.exe (needed before `cargo test`)
param([string]$Features = '', [switch]$NodeOnly)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$shellDir = Join-Path $repo 'shell-tauri'
$work = Join-Path (Split-Path $repo -Parent) 'work'
$out = Join-Path $work 'tauri-build'
$electronBackend = Join-Path $work 'electron-dev\resources\app\backend'

function Get-Sha256([string]$file) { (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant() }

# 1. node.exe, verified against the pinned hash (re-downloaded when missing or different).
$manifest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'node-manifest.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$binDir = Join-Path $shellDir 'binaries'
$nodeBin = Join-Path $binDir 'node-x86_64-pc-windows-msvc.exe'
if (-not (Test-Path -LiteralPath $nodeBin) -or (Get-Sha256 $nodeBin) -ne $manifest.sha256) {
  New-Item -ItemType Directory -Force $binDir | Out-Null
  $partial = "$nodeBin.download"
  Write-Host "Downloading Node $($manifest.version) from $($manifest.url)"
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $manifest.url -OutFile $partial -UseBasicParsing
  $hash = Get-Sha256 $partial
  if ($hash -ne $manifest.sha256) { Remove-Item -LiteralPath $partial -Force; throw "node.exe SHA-256 mismatch: got $hash, expected $($manifest.sha256)" }
  Move-Item -LiteralPath $partial -Destination $nodeBin -Force
}
Write-Host "node.exe $($manifest.version) verified ($($manifest.sha256))"
if ($NodeOnly) { return }

# 2. The Rust shell.
if (-not (Test-Path -LiteralPath (Join-Path $electronBackend 'lumen-host.exe'))) { throw "Missing $electronBackend\lumen-host.exe: run scripts\build-portable.ps1 first." }
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
$cargoArgs = @('tauri', 'build', '--no-bundle')
if ($Features) { $cargoArgs += @('--features', $Features) }
Push-Location $shellDir
# cargo reports progress on stderr; with $ErrorActionPreference='Stop' Windows PowerShell would treat that as an error.
$ErrorActionPreference = 'Continue'
try { & cargo @cargoArgs 2>&1 | ForEach-Object { "$_" }; $code = $LASTEXITCODE } finally { Pop-Location; $ErrorActionPreference = 'Stop' }
if ($code -ne 0) { throw "cargo tauri build failed ($code)" }
$release = Join-Path $shellDir 'target\release'

# 3. The output folder. Running processes lock lumen.exe/node.exe: close Lumen (Tauri) first.
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item -LiteralPath (Join-Path $release 'lumen.exe') -Destination (Join-Path $out 'lumen.exe') -Force
Copy-Item -LiteralPath $nodeBin -Destination (Join-Path $out 'node.exe') -Force
function Invoke-Mirror([string]$from, [string]$to, [string[]]$extra) {
  & robocopy $from $to /MIR /NJH /NJS /NP /NFL /NDL @extra | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "robocopy $from -> $to failed ($LASTEXITCODE)" }
}
# app\ matches what tests\harness\launch.mjs syncApp mirrors (no exes, no engines).
Invoke-Mirror (Join-Path $repo 'app') (Join-Path $out 'app') @('/XF', '*.exe', '/XD', (Join-Path $repo 'app\backend\engines'), (Join-Path $out 'app\backend\engines'))
Invoke-Mirror $electronBackend (Join-Path $out 'backend') @()
$features = if ($Features) { $Features } else { '(none: production)' }
Write-Host "Tauri build ready: $out  features: $features"
exit 0
