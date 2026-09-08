# Download portable ffmpeg into demo-workspace/runtime/ffmpeg (no winget/admin).
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$FfmpegDir = Join-Path $Root "runtime\ffmpeg"
$FfmpegExe = Join-Path $FfmpegDir "ffmpeg.exe"

if (Test-Path $FfmpegExe) {
    Write-Host "[OK] Portable ffmpeg already present: $FfmpegExe"
    exit 0
}

$RuntimeParent = Join-Path $Root "runtime"
New-Item -ItemType Directory -Force -Path $FfmpegDir | Out-Null

$ZipName = "ffmpeg-release-essentials.zip"
$ZipPath = Join-Path $RuntimeParent $ZipName
$Url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

Write-Host "=== Call Coach portable ffmpeg ==="
Write-Host "Target: $FfmpegDir"
Write-Host ""
Write-Host "[1/2] Downloading ffmpeg essentials ..."
Invoke-WebRequest -Uri $Url -OutFile $ZipPath -UseBasicParsing

Write-Host "[2/2] Extracting ffmpeg.exe ..."
$ExtractDir = Join-Path $RuntimeParent "ffmpeg-extract"
if (Test-Path $ExtractDir) { Remove-Item $ExtractDir -Recurse -Force }
Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force
Remove-Item $ZipPath -Force

$BinFfmpeg = Get-ChildItem -Path $ExtractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $BinFfmpeg) {
    throw "ffmpeg.exe not found in downloaded archive"
}
Copy-Item $BinFfmpeg.FullName $FfmpegExe -Force
$BinProbe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1
if ($BinProbe) {
    Copy-Item $BinProbe.FullName (Join-Path $FfmpegDir "ffprobe.exe") -Force
}
Remove-Item $ExtractDir -Recurse -Force

Write-Host ""
Write-Host "[Done] Portable ffmpeg ready:"
Write-Host "  $FfmpegExe"
