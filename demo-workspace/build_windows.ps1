# Build CallCoachAssistant-Windows.zip on Windows (PowerShell).
# Portable package: runtime/python + sources + CallCoachAssistant.cmd
# (Avoids PyInstaller python312.dll failures on Chinese user profile paths.)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Build Call Coach Assistant (Windows) ==="

& .\scripts\bootstrap_portable_python.ps1

$Dist = "dist\CallCoachAssistant"
if (Test-Path $Dist) { Remove-Item $Dist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Dist, "$Dist\input", "$Dist\output", "$Dist\models", "$Dist\logs" | Out-Null

if (-not (Test-Path "runtime\python\python.exe")) {
    throw "Missing runtime\python\python.exe — bootstrap_portable_python failed"
}
New-Item -ItemType Directory -Force -Path "$Dist\runtime" | Out-Null
Copy-Item -Recurse "runtime\python" "$Dist\runtime\python"

$AppFiles = @(
    "demo_app.py",
    "demo_core.py",
    "security.py",
    "upload_parse.py",
    "job_log.py",
    "app_paths.py",
    "啟動 Call Coach.cmd",
    "CallCoachAssistant.cmd",
    ".env.example",
    "START_HERE.txt",
    "README.md"
)
foreach ($file in $AppFiles) {
    Copy-Item $file $Dist -Force
}
Copy-Item -Recurse "demo_app" "$Dist\demo_app"

$Version = (Get-Content "..\package.json" -Raw | ConvertFrom-Json).version
Set-Content -Path "$Dist\VERSION.txt" -Value "Call Coach Assistant Windows v$Version" -Encoding UTF8

# Do not ship CallCoachAssistant.exe — PyInstaller fails on Chinese user profile paths.

if (-not (Test-Path "$Dist\啟動 Call Coach.cmd")) {
    throw "Build failed: 啟動 Call Coach.cmd not found"
}

$Zip = "dist\CallCoachAssistant-Windows.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path $Dist -DestinationPath $Zip -Force

Write-Host ""
Write-Host "[Done] $Zip"
Write-Host "請雙擊「啟動 Call Coach.cmd」啟動（支援中文路徑，勿用 .exe）"
