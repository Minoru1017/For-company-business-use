# Build CallCoachAssistant Windows installer + optional zip.
# Installer: Inno Setup → dist/CallCoachAssistant-Setup.exe
# Installs to C:\CallCoachAssistant (ASCII path) with bundled Python, ffmpeg, WhisperX setup.
param(
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=== Build Call Coach Assistant (Windows) ==="

# Optional Authenticode signing. Active when one of these is provided:
#   CODESIGN_PFX_BASE64       base64 of a .pfx/.p12 (CI secret)          + CODESIGN_PFX_PASSWORD
#   CODESIGN_PFX_PATH         path to a local .pfx/.p12 (developer PC)   + CODESIGN_PFX_PASSWORD
#   CODESIGN_CERT_THUMBPRINT  certificate on a USB token / Windows store (OV/EV certificate)
# See CODESIGN.md for how to obtain a certificate and what Smart App Control accepts
# (public CA, RSA) versus internal-trust only.
$SignPfx = $null
$SignTemp = $false
$SignEnabled = $false
if ($env:CODESIGN_CERT_THUMBPRINT) {
    $thumb = $env:CODESIGN_CERT_THUMBPRINT -replace "\s", ""
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
    if (-not $cert) { throw "CODESIGN_CERT_THUMBPRINT $thumb not found in CurrentUser\My or LocalMachine\My (is the token plugged in?)" }
    $SignEnabled = $true
} elseif ($env:CODESIGN_PFX_BASE64) {
    $SignPfx = Join-Path $env:TEMP "callcoach-codesign.pfx"
    [IO.File]::WriteAllBytes($SignPfx, [Convert]::FromBase64String($env:CODESIGN_PFX_BASE64))
    $SignTemp = $true
} elseif ($env:CODESIGN_PFX_PATH) {
    if (-not (Test-Path $env:CODESIGN_PFX_PATH)) { throw "CODESIGN_PFX_PATH not found: $env:CODESIGN_PFX_PATH" }
    $SignPfx = (Resolve-Path $env:CODESIGN_PFX_PATH).Path
}

if ($SignPfx) {
    if (-not $env:CODESIGN_PFX_PASSWORD) { throw "CODESIGN_PFX_PASSWORD is required when a signing certificate is provided" }
    $env:CODESIGN_PFX_FILE = $SignPfx
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(
        $SignPfx, $env:CODESIGN_PFX_PASSWORD,
        [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
    $SignEnabled = $true
}

if ($SignEnabled) {
    $keyAlg = $cert.PublicKey.Oid.FriendlyName
    $keySize = ""
    try {
        $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($cert)
        if ($rsa) { $keySize = "$($rsa.ExportParameters($false).Modulus.Length * 8) bit" }
    } catch { }
    $selfSigned = ($cert.Subject -eq $cert.Issuer)
    Write-Host "[Sign] Certificate: $($cert.Subject)"
    Write-Host "[Sign]   issuer: $($cert.Issuer)"
    Write-Host "[Sign]   key: $keyAlg $keySize, valid until $($cert.NotAfter.ToString('yyyy-MM-dd'))"
    if ($cert.NotAfter -lt (Get-Date)) { throw "Signing certificate expired on $($cert.NotAfter)" }
    if ($keyAlg -ne "RSA") {
        Write-Warning "[Sign] Key algorithm is $keyAlg — Smart App Control only accepts RSA signatures. Re-issue the certificate with RSA (2048+)."
    }
    if ($selfSigned) {
        Write-Warning "[Sign] Self-signed certificate: valid only on PCs where IT installed the .cer (scripts\Trust-CallCoachPublisher.ps1). Does NOT satisfy Smart App Control / SmartScreen."
    }
    $hasCodeSigningEku = $false
    foreach ($ext in $cert.Extensions) {
        if ($ext -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
            foreach ($oid in $ext.EnhancedKeyUsages) { if ($oid.Value -eq "1.3.6.1.5.5.7.3.3") { $hasCodeSigningEku = $true } }
        }
    }
    if (-not $hasCodeSigningEku) { Write-Warning "[Sign] Certificate lacks the Code Signing EKU (1.3.6.1.5.5.7.3.3); Windows will reject the signature." }
} else {
    Write-Host "[Sign] No signing certificate (CODESIGN_PFX_BASE64 / CODESIGN_PFX_PATH / CODESIGN_CERT_THUMBPRINT) — artifacts will be unsigned (Smart App Control may block)"
}

$SignScript = Join-Path $PSScriptRoot "scripts\Sign-File.ps1"

function Sign-File([string]$Path) {
    if (-not $SignEnabled) { return }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $SignScript $Path
    if ($LASTEXITCODE -ne 0) { throw "Signing failed for $Path" }
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
        $IsccArgs = @("installer\CallCoachAssistant.iss", "/DAppVersion=$Version")
        if ($SignEnabled) {
            # Let Inno Setup sign Setup.exe *and* the embedded uninstaller (unins000.exe);
            # an unsigned uninstaller is otherwise blocked by Smart App Control.
            # $q = double quote, $f = file to sign (Inno Setup SignTool syntax).
            $SignCmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File $q' + $SignScript + '$q $f'
            $IsccArgs += "/DSignBuild"
            $IsccArgs += "/Ssigntool=$SignCmd"
        }
        & $Iscc @IsccArgs
        if ($LASTEXITCODE -ne 0) { throw "ISCC failed (exit $LASTEXITCODE)" }
        $Setup = "dist\CallCoachAssistant-Setup.exe"
        if (-not (Test-Path $Setup)) {
            throw "Installer build failed: $Setup not found"
        }
        if ($SignEnabled) {
            $sig = Get-AuthenticodeSignature $Setup
            Write-Host "[Sign] $Setup — $($sig.Status) — $($sig.SignerCertificate.Subject)"
            if (-not $sig.SignerCertificate) { throw "Setup.exe is not signed although a certificate was provided" }
        }
        Write-Host "[Done] $Setup"
    }
}

if ($SignTemp) { Remove-Item $SignPfx -Force -ErrorAction SilentlyContinue }
Remove-Item Env:\CODESIGN_PFX_FILE -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "公司電腦請使用 CallCoachAssistant-Setup.exe 安裝精靈"
