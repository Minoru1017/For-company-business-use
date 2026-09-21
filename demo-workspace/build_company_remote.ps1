# Build CallCoachCompanyRemote-Setup.exe + zip (company PC only — no WhisperX / assistant).
param()

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Build Call Coach Company Remote (Windows) ==="

$Version = (Get-Content "..\package.json" -Raw | ConvertFrom-Json).version
$Payload = "dist\company-remote-payload"

if (Test-Path $Payload) { Remove-Item $Payload -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Payload, "$Payload\scripts" | Out-Null

$Files = @(
    "start_company_remote_sleep.cmd",
    "REMOTE_HSINCHU.md",
    "START_HERE_COMPANY_REMOTE.txt"
)
foreach ($file in $Files) {
    if (-not (Test-Path $file)) { throw "Missing: $file" }
    Copy-Item $file $Payload -Force
}
Copy-Item "scripts\company_remote_sleep.ps1" "$Payload\scripts\" -Force

$BuildStamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm UTC")
Set-Content -Path "$Payload\VERSION.txt" -Value "Call Coach Company Remote v$Version`nBuilt: $BuildStamp`nGitHub tag: company-remote-v$Version-build.*" -Encoding UTF8

$ZipDist = "dist\CallCoachCompanyRemote"
if (Test-Path $ZipDist) { Remove-Item $ZipDist -Recurse -Force }
Copy-Item $Payload $ZipDist -Recurse -Force

$Zip = "dist\CallCoachCompanyRemote-Windows.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path $ZipDist -DestinationPath $Zip -Force
Write-Host "[Done] $Zip"

$Iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $Iscc)) {
    Write-Host "[提醒] Inno Setup 未安裝，略過 Setup.exe"
    exit 0
}

Write-Host "[Build] Inno Setup installer ..."
& $Iscc @("installer\CallCoachCompanyRemote.iss", "/DAppVersion=$Version")
if ($LASTEXITCODE -ne 0) { throw "ISCC failed (exit $LASTEXITCODE)" }

$Setup = "dist\CallCoachCompanyRemote-Setup.exe"
if (-not (Test-Path $Setup)) { throw "Installer build failed: $Setup not found" }
Write-Host "[Done] $Setup"
