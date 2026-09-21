# Build CallCoachCompanyWake.exe (company PC only — no WhisperX payload).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$Version = (Get-Content "..\package.json" -Raw | ConvertFrom-Json).version
Write-Host "=== Build Call Coach Company Wake v$Version ==="

python -m pip install -q -r requirements-build.txt
if (Test-Path "build") { Remove-Item "build" -Recurse -Force }
if (Test-Path "dist\CallCoachCompanyWake.exe") { Remove-Item "dist\CallCoachCompanyWake.exe" -Force }

python -m PyInstaller --noconfirm call_coach_company_wake.spec

if (-not (Test-Path "dist\CallCoachCompanyWake.exe")) {
    throw "Build failed: dist\CallCoachCompanyWake.exe missing"
}

Copy-Item "start_company_wake.cmd" "dist\" -Force
Write-Host "[Done] dist\CallCoachCompanyWake.exe"
