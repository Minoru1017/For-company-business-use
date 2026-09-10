# Authenticode-sign one or more files with the certificate described by env vars.
# Used by build_windows.ps1 and by Inno Setup (SignTool=...) for Setup.exe / uninstaller.
#
#   CODESIGN_PFX_FILE         path to .pfx / .p12 (PKCS#12 with private key)
#   CODESIGN_PFX_PASSWORD     its password
#     — or, for a certificate on a USB token / in the Windows store (OV/EV certs) —
#   CODESIGN_CERT_THUMBPRINT  SHA-1 thumbprint of the certificate in CurrentUser\My
#   CODESIGN_TIMESTAMP_URL    optional RFC 3161 server (default: DigiCert, then Sectigo fallback)
#
# Windows PowerShell 5.1 compatible (Inno Setup calls powershell.exe).
param(
    [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
    [string[]]$Path
)

$ErrorActionPreference = "Stop"

$pfx = $env:CODESIGN_PFX_FILE
$thumb = $env:CODESIGN_CERT_THUMBPRINT
if ($thumb) {
    $certArgs = @("/sha1", ($thumb -replace "\s", ""))
} elseif ($pfx -and (Test-Path $pfx)) {
    $certArgs = @("/f", $pfx, "/p", $env:CODESIGN_PFX_PASSWORD)
} else {
    throw "Set CODESIGN_PFX_FILE (+ CODESIGN_PFX_PASSWORD) or CODESIGN_CERT_THUMBPRINT; got pfx='$pfx'"
}

function Find-SignTool {
    if ($env:CODESIGN_SIGNTOOL -and (Test-Path $env:CODESIGN_SIGNTOOL)) { return $env:CODESIGN_SIGNTOOL }
    $roots = @("${env:ProgramFiles(x86)}\Windows Kits\10\bin", "$env:ProgramFiles\Windows Kits\10\bin")
    foreach ($root in $roots) {
        $hit = Get-ChildItem "$root\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
            Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
        if ($hit) { return $hit }
    }
    $onPath = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    throw "signtool.exe not found — install the Windows 10/11 SDK (Signing Tools component)"
}

$signtool = Find-SignTool
$timestampServers = @()
if ($env:CODESIGN_TIMESTAMP_URL) { $timestampServers += $env:CODESIGN_TIMESTAMP_URL }
$timestampServers += "http://timestamp.digicert.com", "http://timestamp.sectigo.com"

foreach ($file in $Path) {
    if (-not (Test-Path $file)) { throw "File to sign not found: $file" }
    $signed = $false
    $lastError = ""
    # Timestamp servers are the flaky part of signing; rotate through them.
    foreach ($ts in $timestampServers) {
        for ($attempt = 1; $attempt -le 2 -and -not $signed; $attempt++) {
            & $signtool sign @certArgs /fd SHA256 /tr $ts /td SHA256 `
                /d "Call Coach Assistant" /du "https://github.com/Minoru1017/For-company-business-use" $file 2>&1 |
                ForEach-Object { $lastError = "$_"; Write-Host "  $_" }
            if ($LASTEXITCODE -eq 0) { $signed = $true } else { Start-Sleep -Seconds 3 }
        }
        if ($signed) { break }
    }
    if (-not $signed) { throw "signtool failed for $file — $lastError" }

    $sig = Get-AuthenticodeSignature $file
    $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "(none)" }
    Write-Host "[Sign] $file — $($sig.Status) — $subject"
    if ($sig.Status -ne "Valid") {
        # Self-signed / internal-CA certificates report NotTrusted/UnknownError on a machine that
        # does not trust the root. The signature itself is fine; trust is a deployment matter.
        Write-Host "[Sign]   status '$($sig.Status)': chain not trusted on this machine (expected for self-signed / internal CA)"
    }
}
