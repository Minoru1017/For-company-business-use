# Build CallCoachAssistant Windows installer + optional zip.
# Installer: Inno Setup → dist/CallCoachAssistant-Setup.exe
# Installs to C:\CallCoachAssistant (ASCII path) with bundled Python, ffmpeg, WhisperX setup.
param(
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Build Call Coach Assistant (Windows) ==="

# Optional Authenticode signing — active only when CODESIGN_PFX_BASE64 is provided.
# Smart App Control (Windows 11) blocks unsigned executables; signing lets it pass.
$SignPfx = $null
if ($env:CODESIGN_PFX_BASE64) {
    $SignPfx = Join-Path $env:TEMP "callcoach-codesign.pfx"
    [IO.File]::WriteAllBytes($SignPfx, [Convert]::FromBase64String($env:CODESIGN_PFX_BASE64))
    Write-Host "[Sign] Code-signing certificate loaded"
} else {
    Write-Host "[Sign] CODESIGN_PFX_BASE64 not set — artifacts will be unsigned (Smart App Control may block)"
}

function Sign-File([string]$Path) {
    if (-not $SignPfx) { return }
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    if (-not $signtool) { throw "signtool.exe not found (install Windows SDK)" }
    $ts = if ($env:CODESIGN_TIMESTAMP_URL) { $env:CODESIGN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }
    & $signtool sign /f $SignPfx /p $env:CODESIGN_PFX_PASSWORD /fd SHA256 /tr $ts /td SHA256 /d "Call Coach Assistant" $Path
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $Path" }
    Write-Host "[Sign] $Path"
}

& .\scripts\bootstrap_portable_python.ps1
& .\scripts\bootstrap_portable_ffmpeg.ps1

$Version = (Get-Content "..\package.json" -Raw | ConvertFrom-Json).version
$Payload = "dist\installer-payload"
$PyiDist = "dist\CallCoachAssistant-exe"

if (Test-Path $Payload) { Remove-Item $Payload -Recurse -Force }
if (Test-Path $PyiDist) { Remove-Item $PyiDist -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Payload, "$Payload\input", "$Payload\output", "$Payload\models", "$Payload\logs", "$Payload\installer" | Out-Null

if (-not (Test-Path "runtime\python\python.exe")) {
    throw "Missing runtime\python\python.exe"
}
if (-not (Test-Path "runtime\ffmpeg\ffmpeg.exe")) {
    throw "Missing runtime\ffmpeg\ffmpeg.exe"
}

New-Item -ItemType Directory -Force -Path "$Payload\runtime" | Out-Null
Copy-Item -Recurse "runtime\python" "$Payload\runtime\python"
New-Item -ItemType Directory -Force -Path "$Payload\runtime\ffmpeg" | Out-Null
Copy-Item "runtime\ffmpeg\*" "$Payload\runtime\ffmpeg" -Force

$AppFiles = @(
    "demo_app.py",
    "demo_core.py",
    "srt_utils.py",
    "proc_utils.py",
    "transcribe_parallel.py",
    "transcribe_modes.py",
    "azure_transcribe.py",
    "team_config.py",
    "security.py",
    "upload_parse.py",
    "job_log.py",
    "app_paths.py",
    ".env.example",
    "START_HERE.txt",
    "README.md"
)
foreach ($file in $AppFiles) {
    Copy-Item $file $Payload -Force
}
Copy-Item -Recurse "demo_app" "$Payload\demo_app"
Copy-Item "installer\setup_env.py" "$Payload\installer\setup_env.py" -Force

Set-Content -Path "$Payload\VERSION.txt" -Value "Call Coach Assistant Windows v$Version (installer)" -Encoding UTF8

Write-Host "[Build] PyInstaller application (.exe) ..."
python -m pip install -q -r requirements-build.txt
if (Test-Path "build") { Remove-Item "build" -Recurse -Force }
python -m PyInstaller --noconfirm call_coach_assistant.spec

if (-not (Test-Path "$PyiDist\CallCoachAssistant.exe")) {
    throw "PyInstaller build failed"
}
Sign-File "$PyiDist\CallCoachAssistant.exe"
Sign-File "$Payload\runtime\ffmpeg\ffmpeg.exe"
Sign-File "$Payload\runtime\ffmpeg\ffprobe.exe"
Copy-Item "$PyiDist\CallCoachAssistant.exe" $Payload -Force
Copy-Item "$PyiDist\_internal" "$Payload\_internal" -Recurse -Force
Write-Host "[OK] CallCoachAssistant.exe (install to C:\CallCoachAssistant)"

# Portable zip (dev / fallback — includes .cmd)
$ZipDist = "dist\CallCoachAssistant"
if (Test-Path $ZipDist) { Remove-Item $ZipDist -Recurse -Force }
Copy-Item $Payload $ZipDist -Recurse -Force
Copy-Item "啟動 Call Coach.cmd" $ZipDist -Force
Copy-Item "CallCoachAssistant.cmd" $ZipDist -Force

$Zip = "dist\CallCoachAssistant-Windows.zip"
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path $ZipDist -DestinationPath $Zip -Force
Write-Host "[Done] $Zip"

if (-not $SkipInstaller) {
    $Iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    if (-not (Test-Path $Iscc)) {
        Write-Host "[提醒] Inno Setup 未安裝，略過 Setup.exe（請在 CI 或安裝 Inno Setup 6 後重試）"
    } else {
        Write-Host "[Build] Inno Setup installer ..."
        & $Iscc "installer\CallCoachAssistant.iss" "/DAppVersion=$Version"
        $Setup = "dist\CallCoachAssistant-Setup.exe"
        if (-not (Test-Path $Setup)) {
            throw "Installer build failed: $Setup not found"
        }
        Sign-File $Setup
        Write-Host "[Done] $Setup"
    }
}

if ($SignPfx) { Remove-Item $SignPfx -Force -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "公司電腦請使用 CallCoachAssistant-Setup.exe 安裝精靈"
