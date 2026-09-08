# Download portable Python 3.12 into demo-workspace/runtime/python (no winget/admin).
param(
    [string]$Version = "3.12.7"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RuntimeDir = Join-Path $Root "runtime\python"
$PythonExe = Join-Path $RuntimeDir "python.exe"

if (Test-Path $PythonExe) {
    Write-Host "[OK] Portable Python already present: $PythonExe"
    exit 0
}

$RuntimeParent = Join-Path $Root "runtime"
New-Item -ItemType Directory -Force -Path $RuntimeParent | Out-Null

$ZipName = "python-$Version-embed-amd64.zip"
$ZipPath = Join-Path $RuntimeParent $ZipName
$BaseUrl = "https://www.python.org/ftp/python/$Version"

Write-Host "=== Call Coach portable Python $Version ==="
Write-Host "Target: $RuntimeDir"
Write-Host ""

Write-Host "[1/3] Downloading $ZipName ..."
Invoke-WebRequest -Uri "$BaseUrl/$ZipName" -OutFile $ZipPath -UseBasicParsing

Write-Host "[2/3] Extracting ..."
if (Test-Path $RuntimeDir) {
    Remove-Item $RuntimeDir -Recurse -Force
}
Expand-Archive -Path $ZipPath -DestinationPath $RuntimeDir -Force
Remove-Item $ZipPath -Force

$PthFile = Get-ChildItem $RuntimeDir -Filter "python*._pth" | Select-Object -First 1
if (-not $PthFile) {
    throw "Could not find python*._pth in portable runtime"
}

$PthLines = Get-Content $PthFile.FullName | ForEach-Object {
    if ($_ -eq "#import site") { "import site" } else { $_ }
}
if ($PthLines -notcontains "import site") {
    $PthLines += "import site"
}
Set-Content -Path $PthFile.FullName -Value $PthLines -Encoding Ascii

$SitePackages = Join-Path $RuntimeDir "Lib\site-packages"
New-Item -ItemType Directory -Force -Path $SitePackages | Out-Null

$GetPip = Join-Path $RuntimeParent "get-pip.py"
Write-Host "[3/3] Installing pip ..."
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $GetPip -UseBasicParsing
& $PythonExe $GetPip --no-warn-script-location
Remove-Item $GetPip -Force

Write-Host ""
Write-Host "[Done] Portable Python ready:"
Write-Host "  $PythonExe"
Write-Host "Next: double-click start_call_coach.cmd"
