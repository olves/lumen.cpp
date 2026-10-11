# Builds the four files of a Lumen Beta release from a portable app folder:
#   lumen-beta-portable.zip, lumen-beta-setup.exe, lumen-update.json, lumen-update.json.sig
#
#   .\scripts\release.ps1 -AppDir <portable Lumen-Beta folder> -OutDir <folder> -NotesEn "..." -NotesTr "..."
#
# The build number comes from resources/app/package.json ("0.1.0-beta.N"); raise it before every release, because Lumen
# only offers builds newer than its own. lumen-update.json is signed with the offline release key
# (%USERPROFILE%\.lumen-release\update-signing-key.pem by default). Keep that key private and backed up: without it, future
# releases cannot be installed as updates. Never commit it.
param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$NotesEn = '',
  [string]$NotesTr = '',
  [string]$Key = "$env:USERPROFILE\.lumen-release\update-signing-key.pem",
  [string]$PublicKey = "$env:USERPROFILE\.lumen-release\update-public-key.pem",
  [string]$Iscc = "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)
$ErrorActionPreference = 'Stop'
$AppDir = (Resolve-Path $AppDir).Path
New-Item -ItemType Directory -Force $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$version = (Get-Content (Join-Path $AppDir 'resources\app\package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '-beta\.(\d+)$') { throw "package.json version must end in -beta.N (found $version)." }
$build = [int]$Matches[1]
foreach ($f in 'lumen.cpp.exe', 'resources\app\main.cjs', 'resources\app\backend\lumen-updater.exe', 'resources\app\backend\lumen-host.exe') {
  if (-not (Test-Path (Join-Path $AppDir $f))) { throw "Missing $f in $AppDir" }
}
if (-not (Test-Path $Key)) { throw "Signing key not found: $Key" }
if (-not (Test-Path $Iscc)) { throw "Inno Setup compiler not found: $Iscc" }

# Runs scripts\release-tool.cjs with the app's own Electron in Node mode.
function Tool([string[]]$arguments) {
  $errorFile = Join-Path $env:TEMP 'lumen-release-tool.error'; Remove-Item $errorFile -ErrorAction SilentlyContinue
  $env:ELECTRON_RUN_AS_NODE = '1'
  try { $p = Start-Process (Join-Path $AppDir 'lumen.cpp.exe') -ArgumentList (@((Join-Path $PSScriptRoot 'release-tool.cjs')) + $arguments | ForEach-Object { '"' + $_ + '"' }) -Wait -PassThru -NoNewWindow }
  finally { Remove-Item Env:ELECTRON_RUN_AS_NODE }
  if ($p.ExitCode -ne 0) { throw "release-tool $($arguments[0]) failed: $(Get-Content $errorFile -Raw -ErrorAction SilentlyContinue)" }
}

# Refuse to ship text that was saved with the wrong encoding (UTF-8 read as a Windows code page and saved again).
$garbled = Get-ChildItem (Join-Path $AppDir 'resources\app') -Recurse -File -Include *.js, *.cjs, *.css, *.html, *.json |
  Where-Object { $_.FullName -notmatch '\\vendor\\' } |
  Where-Object { [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8) -match ([string][char]0xC3 + '[' + [char]0x80 + '-' + [char]0xBF + [char]0xBC + [char]0xA7 + [char]0xB6 + [char]0xB1 + ']|' + [char]0xC4 + [char]0xB1 + '|' + [char]0xC5 + [char]0x178 + '|' + [char]0xE2 + [char]0x20AC) }
if ($garbled) { throw "Garbled (double-encoded) text in: $($garbled.Name -join ', ')" }

Write-Host "Beta build $build ($version)"
$zip = Join-Path $OutDir 'lumen-beta-portable.zip'
Remove-Item $zip -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$stream = [IO.File]::Open($zip, 'CreateNew'); $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $AppDir -Recurse -File -Force | Where-Object { $_.Name -notin 'debug.log', 'ui-check.cjs' } | ForEach-Object {
    $name = 'Lumen-Beta/' + $_.FullName.Substring($AppDir.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Host "ZIP: $zip"

Remove-Item (Join-Path $OutDir 'lumen-beta-setup.exe') -ErrorAction SilentlyContinue
& $Iscc /Qp "/DSourceDir=$AppDir" "/DAppVersion=$version" "/DBuild=$build" "/DOutputDir=$OutDir" (Join-Path $PSScriptRoot 'lumen.iss')
if ($LASTEXITCODE) { throw 'Inno Setup failed.' }
$setup = Join-Path $OutDir 'lumen-beta-setup.exe'
Write-Host "Setup: $setup"

$manifest = Join-Path $OutDir 'lumen-update.json'
# Notes go through a UTF-8 file: quotes and non-ASCII text do not survive a Windows command line reliably.
$notesFile = Join-Path $env:TEMP 'lumen-release-notes.json'
[IO.File]::WriteAllText($notesFile, (@{ en = $NotesEn; tr = $NotesTr } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
Tool @('manifest', $manifest, "$build", $version, $notesFile, $zip, $setup)
Remove-Item $notesFile -ErrorAction SilentlyContinue
Tool @('sign', $Key, $manifest)
if (Test-Path $PublicKey) { Tool @('verify', $PublicKey, $manifest) }
Write-Host ''
Write-Host 'Upload these four files to a GitHub release (mark it as a pre-release):'
Get-ChildItem $zip, $setup, $manifest, "$manifest.sig" | ForEach-Object { '  {0,-28} {1,10:N1} MB' -f $_.Name, ($_.Length / 1MB) }
