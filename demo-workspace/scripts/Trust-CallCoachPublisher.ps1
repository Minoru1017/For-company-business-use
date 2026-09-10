# IT helper: trust the Call Coach code-signing certificate on a company PC.
# Installs the PUBLIC certificate (.cer, no private key) into
#   LocalMachine\Root              — so the signature chain validates (self-signed cert = its own root)
#   LocalMachine\TrustedPublisher  — so UAC / AppLocker / WDAC publisher rules recognise it
#
# Run as Administrator:
#   .\Trust-CallCoachPublisher.ps1 -CerPath .\CallCoach-CodeSign.cer
# Remove again:
#   .\Trust-CallCoachPublisher.ps1 -CerPath .\CallCoach-CodeSign.cer -Remove
#
# Note: this does NOT satisfy Windows 11 Smart App Control, which only honours certificates
# from CAs in Microsoft's Trusted Root Program. See CODESIGN.md.
#Requires -RunAsAdministrator
param(
    [Parameter(Mandatory = $true)]
    [string]$CerPath,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $CerPath)) { throw "Certificate file not found: $CerPath" }

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2((Resolve-Path $CerPath).Path)
if ($cert.HasPrivateKey) { throw "Refusing to import a file that contains a private key; use the .cer, not the .pfx" }
Write-Host "[Trust] $($cert.Subject)  thumbprint $($cert.Thumbprint)  valid until $($cert.NotAfter.ToString('yyyy-MM-dd'))"

$stores = @("Root", "TrustedPublisher")
foreach ($storeName in $stores) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($storeName, "LocalMachine")
    $store.Open("ReadWrite")
    try {
        $existing = $store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
        if ($Remove) {
            foreach ($c in $existing) { $store.Remove($c) }
            Write-Host "[Trust] removed from LocalMachine\$storeName"
        } elseif ($existing) {
            Write-Host "[Trust] already present in LocalMachine\$storeName"
        } else {
            $store.Add($cert)
            Write-Host "[Trust] added to LocalMachine\$storeName"
        }
    } finally {
        $store.Close()
    }
}

if (-not $Remove) {
    Write-Host ""
    Write-Host "驗證方式：對已簽章的 CallCoachAssistant-Setup.exe 執行"
    Write-Host "  Get-AuthenticodeSignature .\CallCoachAssistant-Setup.exe   → Status 應為 Valid"
}
