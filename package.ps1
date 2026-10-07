# Zips the runtime files into dist/send-to-kop-<version>.zip for the Chrome Web Store and Firefox AMO.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist "send-to-kop-$version.zip"
if (Test-Path $zip) { Remove-Item $zip }

$files = @('manifest.json', 'api.js', 'background.js', 'classify.js', 'extract.js',
           'options.html', 'options.js', 'popup.html', 'popup.js', 'style.css') +
         (Get-ChildItem (Join-Path $root 'icons') -File | ForEach-Object { "icons/$($_.Name)" })

# Entries need forward slashes (Compress-Archive on Windows PowerShell 5.1 writes backslashes).
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  foreach ($f in $files) {
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, (Join-Path $root $f), $f, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }
Write-Host "Wrote $zip"
