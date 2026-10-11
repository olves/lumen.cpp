# Builds a portable Lumen Beta folder from this repository.
#
#   .\scripts\build-portable.ps1 -Backend <path to lumen-core-beta.exe> [-Out dist\Lumen-Beta]
#
# Steps: downloads Electron 44.5.1 (win32-x64) and checks its SHA-256 against scripts/electron-manifest.json, extracts it,
# renames electron.exe to lumen.cpp.exe, copies app/ to resources/app, and compiles the two small helpers (lumen-host.exe,
# lumen-image-ocr.exe) with the .NET Framework 4.8 compiler that ships with Windows.
#
# The native backend lumen-core-beta.exe is not built here: its source is not part of this repository. Take it from the
# portable ZIP on the Releases page (resources/app/backend/lumen-core-beta.exe).
# The release build also carries the Lumen icon in the executable's resources; this script does not change the icon.
param(
  [Parameter(Mandatory = $true)][string]$Backend,
  [string]$Out = 'dist\Lumen-Beta'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content (Join-Path $PSScriptRoot 'electron-manifest.json') -Raw | ConvertFrom-Json
if (-not (Test-Path $Backend)) { throw "lumen-core-beta.exe not found: $Backend" }
if (Test-Path $Out) { throw "Output folder already exists: $Out (choose another -Out or remove it yourself)" }

$cache = Join-Path $repo 'dist\cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$zip = Join-Path $cache $manifest.name
if (-not (Test-Path $zip)) {
  $url = "https://github.com/electron/electron/releases/download/$($manifest.v)/$($manifest.name)"
  Write-Host "Downloading $url"
  Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
}
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($hash -ne $manifest.sha256) { Remove-Item $zip; throw "Electron download hash mismatch ($hash)." }

Write-Host "Extracting Electron to $Out"
New-Item -ItemType Directory -Force $Out | Out-Null
Expand-Archive $zip -DestinationPath $Out
Rename-Item (Join-Path $Out 'electron.exe') 'lumen.cpp.exe'
$defaultApp = Join-Path $Out 'resources\default_app.asar'
if (Test-Path $defaultApp) { Remove-Item $defaultApp }

$app = Join-Path $Out 'resources\app'
Copy-Item (Join-Path $repo 'app') $app -Recurse
Copy-Item $Backend (Join-Path $app 'backend\lumen-core-beta.exe')
Copy-Item (Join-Path $repo 'docs\licenses-llama.cpp.txt') (Join-Path $Out 'LLAMA-LICENSE.txt')
Copy-Item (Join-Path $repo 'docs\USER-GUIDE.md') (Join-Path $Out 'README.md')

$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fw 'csc.exe'
$backendDir = Join-Path $app 'backend'
Push-Location $backendDir
try {
  & $csc /nologo /target:exe /out:lumen-host.exe /r:lumen-core-beta.exe /r:System.Web.Extensions.dll /r:System.Net.Http.dll LumenHost.cs
  if ($LASTEXITCODE) { throw 'lumen-host.exe did not compile.' }
  $wm = Join-Path $env:WINDIR 'System32\WinMetadata'
  & $csc /nologo /target:exe /out:lumen-image-ocr.exe "/r:$wm\Windows.Foundation.winmd" "/r:$wm\Windows.Storage.winmd" "/r:$wm\Windows.Graphics.winmd" "/r:$wm\Windows.Media.winmd" "/r:$wm\Windows.Globalization.winmd" "/r:$fw\System.Runtime.WindowsRuntime.dll" "/r:$fw\System.Web.Extensions.dll" /r:System.Runtime.dll /r:System.Threading.Tasks.dll ImageOcr.cs
  if ($LASTEXITCODE) { throw 'lumen-image-ocr.exe did not compile.' }
  & $csc /nologo /target:winexe /out:lumen-updater.exe /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Windows.Forms.dll LumenUpdater.cs
  if ($LASTEXITCODE) { throw 'lumen-updater.exe did not compile.' }
} finally { Pop-Location }
Write-Host "Done: $Out\lumen.cpp.exe"
