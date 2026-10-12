# Builds a portable Lumen Beta folder from this repository.
#
#   .\scripts\build-portable.ps1 [-Out dist\Lumen-Beta]
#
# Steps:
#   1. Downloads Electron 44.5.1 (win32-x64), checks its SHA-256 against scripts/electron-manifest.json, extracts it and renames
#      electron.exe to lumen.cpp.exe.
#   2. Copies app/ to resources/app.
#   3. Downloads the official llama.cpp b11438 CPU and Vulkan builds from github.com/ggml-org/llama.cpp, checks their size and
#      SHA-256, and puts them in resources/app/backend/engines (Lumen unpacks them on first use).
#   4. Compiles lumen-host.exe, lumen-image-ocr.exe and lumen-updater.exe with the .NET Framework 4.8 compiler that ships with
#      Windows.
# Everything in the folder is built from this repository or downloaded from the official, pinned upstream releases.
# The release build also carries the Lumen icon in the executable's resources; this script does not change the icon.
param(
  [string]$Out = 'dist\Lumen-Beta'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content (Join-Path $PSScriptRoot 'electron-manifest.json') -Raw | ConvertFrom-Json
if (Test-Path $Out) { throw "Output folder already exists: $Out (choose another -Out or remove it yourself)" }

$cache = Join-Path $repo 'dist\cache'
New-Item -ItemType Directory -Force $cache | Out-Null
# A file in the download cache, fetched once and checked against its pinned SHA-256 (and size, when given).
function Get-Pinned([string]$Url, [string]$Name, [string]$Sha256, [long]$Size = 0) {
  $file = Join-Path $cache $Name
  if (-not (Test-Path $file)) {
    Write-Host "Downloading $Url"
    Invoke-WebRequest $Url -OutFile $file -UseBasicParsing
  }
  $hash = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $Sha256 -or ($Size -and (Get-Item $file).Length -ne $Size)) { Remove-Item $file; throw "$Name failed its SHA-256 check ($hash)." }
  return $file
}

$zip = Get-Pinned "https://github.com/electron/electron/releases/download/$($manifest.v)/$($manifest.name)" $manifest.name $manifest.sha256
Write-Host "Extracting Electron to $Out"
New-Item -ItemType Directory -Force $Out | Out-Null
Expand-Archive $zip -DestinationPath $Out
Rename-Item (Join-Path $Out 'electron.exe') 'lumen.cpp.exe'
$defaultApp = Join-Path $Out 'resources\default_app.asar'
if (Test-Path $defaultApp) { Remove-Item $defaultApp }

$app = Join-Path $Out 'resources\app'
Copy-Item (Join-Path $repo 'app') $app -Recurse
Copy-Item (Join-Path $repo 'docs\licenses-llama.cpp.txt') (Join-Path $Out 'LLAMA-LICENSE.txt')
Copy-Item (Join-Path $repo 'LICENSE') (Join-Path $Out 'LUMEN-LICENSE.txt')
Copy-Item (Join-Path $repo 'NOTICE') (Join-Path $Out 'NOTICE.txt')
Copy-Item (Join-Path $repo 'THIRD_PARTY_NOTICES.md') (Join-Path $Out 'THIRD_PARTY_NOTICES.md')
Copy-Item (Join-Path $repo 'docs\USER-GUIDE.md') (Join-Path $Out 'README.md')

# The bundled llama.cpp engines: the official b11438 Windows x64 archives, byte for byte.
$engines = Join-Path $app 'backend\engines'
New-Item -ItemType Directory -Force $engines | Out-Null
$llama = 'https://github.com/ggml-org/llama.cpp/releases/download/b11438'
foreach ($e in @(
    @{ kind = 'cpu'; name = 'llama-b11438-bin-win-cpu-x64.zip'; sha = '8f9350b0082d1b9052992991456206070e817bfa63cd8d49e7b3bad304306c9e'; size = 19399367 },
    @{ kind = 'vulkan'; name = 'llama-b11438-bin-win-vulkan-x64.zip'; sha = '7413c81c21d9d3714dbeec98fee098154ba58f1496635314196a3c1ac03ca571'; size = 33337555 })) {
  $file = Get-Pinned "$llama/$($e.name)" $e.name $e.sha $e.size
  Copy-Item $file (Join-Path $engines "llama-$($e.kind).zip")
}

$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fw 'csc.exe'
$backendDir = Join-Path $app 'backend'
Push-Location $backendDir
try {
  & $csc /nologo /target:exe /out:lumen-host.exe /r:System.Web.Extensions.dll /r:System.Net.Http.dll /r:System.Management.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll LumenHost.cs LumenCore.cs
  if ($LASTEXITCODE) { throw 'lumen-host.exe did not compile.' }
  $wm = Join-Path $env:WINDIR 'System32\WinMetadata'
  & $csc /nologo /target:exe /out:lumen-image-ocr.exe "/r:$wm\Windows.Foundation.winmd" "/r:$wm\Windows.Storage.winmd" "/r:$wm\Windows.Graphics.winmd" "/r:$wm\Windows.Media.winmd" "/r:$wm\Windows.Globalization.winmd" "/r:$fw\System.Runtime.WindowsRuntime.dll" "/r:$fw\System.Web.Extensions.dll" /r:System.Runtime.dll /r:System.Threading.Tasks.dll ImageOcr.cs
  if ($LASTEXITCODE) { throw 'lumen-image-ocr.exe did not compile.' }
  & $csc /nologo /target:winexe /out:lumen-updater.exe /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Windows.Forms.dll LumenUpdater.cs
  if ($LASTEXITCODE) { throw 'lumen-updater.exe did not compile.' }
} finally { Pop-Location }
Write-Host "Done: $Out\lumen.cpp.exe"
