# Create an RSA code-signing certificate for INTERNAL trust (same idea as the ServBay
# "Code Signing" certificate, but issued locally and RSA so Windows tooling accepts it).
#
# What it gives you:
#   dist\codesign\CallCoach-CodeSign.pfx      private key + cert  → GitHub secret / local build
#   dist\codesign\CallCoach-CodeSign.cer      public cert         → IT installs on company PCs
#   dist\codesign\CODESIGN_PFX_BASE64.txt     paste into GitHub → Settings → Secrets → CODESIGN_PFX_BASE64
#
# What it does NOT give you: Smart App Control / SmartScreen trust. Those require a certificate
# from a CA in Microsoft's Trusted Root Program (see CODESIGN.md).
#
# Usage (Windows PowerShell 5.1 or pwsh, no admin needed):
#   .\scripts\New-CodeSigningCert.ps1 -Organization "貴公司名稱"
#   .\scripts\New-CodeSigningCert.ps1 -Organization "貴公司名稱" -TrustLocally   # also trust on this PC
param(
    [Parameter(Mandatory = $true)]
    [string]$Organization,
    [string]$CommonName = "Call Coach Assistant",
    [int]$Years = 3,
    [int]$KeyLength = 3072,
    [string]$OutDir = (Join-Path $PSScriptRoot "..\dist\codesign"),
    [SecureString]$Password,
    [switch]$TrustLocally
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "This script uses the Windows certificate store; run it on Windows." }

if (-not $Password) {
    $Password = Read-Host -AsSecureString "PFX 密碼（之後要填到 GitHub secret CODESIGN_PFX_PASSWORD）"
    $confirm = Read-Host -AsSecureString "再輸入一次"
    $a = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))
    $b = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm))
    if ($a -ne $b) { throw "兩次密碼不一致" }
    if ($a.Length -lt 12) { throw "密碼至少 12 字元" }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$pfxPath = Join-Path $OutDir "CallCoach-CodeSign.pfx"
$cerPath = Join-Path $OutDir "CallCoach-CodeSign.cer"
$b64Path = Join-Path $OutDir "CODESIGN_PFX_BASE64.txt"

$subject = "CN=$CommonName, O=$Organization"
Write-Host "[Cert] Creating $subject (RSA $KeyLength, SHA-256, $Years years)…"
# RSA is mandatory: Smart App Control and older signtool paths reject ECC signatures.
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -FriendlyName "Call Coach Assistant code signing" `
    -KeyAlgorithm RSA -KeyLength $KeyLength -HashAlgorithm SHA256 `
    -KeyUsage DigitalSignature `
    -KeyExportPolicy Exportable `
    -CertStoreLocation Cert:\CurrentUser\My `
    -NotAfter (Get-Date).AddYears($Years)

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $Password | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
[Convert]::ToBase64String([IO.File]::ReadAllBytes($pfxPath)) | Set-Content -Path $b64Path -NoNewline -Encoding ASCII

# The private key is now in the .pfx; keep the store copy out of the way.
Remove-Item -Path ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -ErrorAction SilentlyContinue

if ($TrustLocally) {
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPublisher | Out-Null
    Write-Host "[Cert] Trusted for the current user on this PC (Root + TrustedPublisher)"
}

Write-Host ""
Write-Host "[Cert] Thumbprint : $($cert.Thumbprint)"
Write-Host "[Cert] Valid until: $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "[Cert] PFX        : $pfxPath   (機密！不要提交到 git)"
Write-Host "[Cert] CER        : $cerPath   (公開，交給 IT 佈署到公司電腦)"
Write-Host "[Cert] Base64     : $b64Path"
Write-Host ""
Write-Host "下一步："
Write-Host "  1. GitHub → Settings → Secrets and variables → Actions → New repository secret"
Write-Host "       CODESIGN_PFX_BASE64     = $b64Path 的內容"
Write-Host "       CODESIGN_PFX_PASSWORD   = 剛設定的密碼"
Write-Host "  2. 公司電腦（IT，系統管理員）："
Write-Host "       .\scripts\Trust-CallCoachPublisher.ps1 -CerPath CallCoach-CodeSign.cer"
Write-Host "  3. 本機測試簽章："
Write-Host "       `$env:CODESIGN_PFX_PATH='$pfxPath'; `$env:CODESIGN_PFX_PASSWORD='…'; .\build_windows.ps1"
Write-Host ""
Write-Warning "此為自簽憑證：只在裝了 .cer 的電腦被信任；無法通過 Smart App Control 或 SmartScreen（需公開 CA 憑證，見 CODESIGN.md）。"
