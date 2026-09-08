# Build CallCoachAssistant-Windows.zip on Windows (PowerShell).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Build Call Coach Assistant (Windows) ==="

python -m pip install -r requirements-build.txt
& .\scripts\bootstrap_portable_python.ps1

if (Test-Path "build") { Remove-Item "build" -Recurse -Force }
if (Test-Path "dist\CallCoachAssistant") { Remove-Item "dist\CallCoachAssistant" -Recurse -Force }

python -m PyInstaller --noconfirm call_coach_assistant.spec

$Dist = "dist\CallCoachAssistant"
if (-not (Test-Path "$Dist\CallCoachAssistant.exe")) {
    throw "Build failed: CallCoachAssistant.exe not found"
}

New-Item -ItemType Directory -Force -Path "$Dist\input", "$Dist\output", "$Dist\models" | Out-Null
Copy-Item ".env.example" $Dist -Force
Copy-Item "START_HERE.txt" $Dist -Force
Copy-Item "README.md" $Dist -Force

if (-not (Test-Path "runtime\python\python.exe")) {
    throw "Missing runtime\python\python.exe — bootstrap_portable_python failed"
}
New-Item -ItemType Directory -Force -Path "$Dist\runtime" | Out-Null
Copy-Item -Recurse "runtime\python" "$Dist\runtime\python"

$Zip = "dist\CallCoachAssistant-Windows.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path $Dist -DestinationPath $Zip -Force

Write-Host ""
Write-Host "[Done] $Zip"
Write-Host "Share this zip with colleagues — unzip and run CallCoachAssistant.exe"
