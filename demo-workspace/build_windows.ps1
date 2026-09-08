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
    "CallCoachAssistant.cmd",
    ".env.example",
    "START_HERE.txt",
    "README.md"
)
foreach ($file in $AppFiles) {
    Copy-Item $file $Dist -Force
}
Copy-Item -Recurse "demo_app" "$Dist\demo_app"

# Optional legacy .exe via PyInstaller (separate folder — must not overwrite portable $Dist)
$PyiDist = "dist\CallCoachAssistant-exe"
try {
    python -m pip install -q -r requirements-build.txt
    if (Test-Path "build") { Remove-Item "build" -Recurse -Force }
    if (Test-Path $PyiDist) { Remove-Item $PyiDist -Recurse -Force }
    python -m PyInstaller --noconfirm call_coach_assistant.spec
    $BuiltExe = "$PyiDist\CallCoachAssistant.exe"
    if (Test-Path $BuiltExe) {
        Copy-Item $BuiltExe $Dist -Force
        Write-Host "[OK] Built optional CallCoachAssistant.exe (use .cmd if DLL error)"
    }
} catch {
    Write-Host "[提醒] PyInstaller 略過: $_"
}

if (-not (Test-Path "$Dist\CallCoachAssistant.cmd")) {
    throw "Build failed: CallCoachAssistant.cmd not found"
}

$Zip = "dist\CallCoachAssistant-Windows.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path $Dist -DestinationPath $Zip -Force

Write-Host ""
Write-Host "[Done] $Zip"
Write-Host "請雙擊 CallCoachAssistant.cmd 啟動（建議，支援中文路徑）"
