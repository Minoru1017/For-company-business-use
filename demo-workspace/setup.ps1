#Requires -Version 5.1
<#
.SYNOPSIS
  在 demo-workspace 內建立 .venv 並安裝 WhisperX（一次性）。

.DESCRIPTION
  - 虛擬環境：.\.venv
  - 模型快取：.\models（透過環境變數，不寫入使用者家目錄）
  - 需網路；不會上傳任何音檔
#>
param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

Write-Host "=== DEMO Workspace 安裝 ===" -ForegroundColor Cyan
Write-Host "工作目錄: $Root"

# 目錄
@("models", "input", "output") | ForEach-Object {
    if (-not (Test-Path $_)) { New-Item -ItemType Directory -Path $_ | Out-Null }
}

# Python 版本
$ver = & $Python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
if (-not $ver) { throw "找不到 Python。請先安裝 Python 3.10～3.12 並加入 PATH。" }
$major, $minor = $ver.Split(".")
if ([int]$major -lt 3 -or ([int]$major -eq 3 -and [int]$minor -lt 10)) {
    throw "需要 Python 3.10 以上，目前: $ver"
}
Write-Host "Python $ver OK"

# 虛擬環境
$venvPath = Join-Path $Root ".venv"
$activate = Join-Path $venvPath "Scripts\Activate.ps1"

if (-not (Test-Path $activate)) {
    Write-Host "建立虛擬環境 .venv ..."
    & $Python -m venv $venvPath
}

. $activate
python -m pip install -U pip wheel
Write-Host "安裝 whisperx（首次可能需數分鐘）..."
pip install whisperx

# 寫入啟用腳本用的環境變數（每次 activate 時載入模型路徑）
$envMarker = "# demo-workspace-local-cache"
$activateContent = Get-Content $activate -Raw
if ($activateContent -notmatch [regex]::Escape($envMarker)) {
    @"

$envMarker
`$env:HF_HOME = "$Root\models"
`$env:HUGGINGFACE_HUB_CACHE = "$Root\models\hub"
`$env:TORCH_HOME = "$Root\models\torch"
`$env:XDG_CACHE_HOME = "$Root\models"
"@ | Add-Content $activate
    Write-Host "已設定模型快取至 .\models"
}

# ffmpeg 檢查
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "找不到 ffmpeg。請執行: winget install Gyan.FFmpeg"
} else {
    Write-Host "ffmpeg OK"
}

# .env 提示
if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
    Write-Host ""
    Write-Warning "已建立 .env — 請編輯並填入 HF_TOKEN，並接受 pyannote 模型授權。"
}

Write-Host ""
Write-Host "=== 安裝完成 ===" -ForegroundColor Green
Write-Host "下一步:"
Write-Host "  1. 編輯 .env 填入 HF_TOKEN"
Write-Host "  2. 將 demo.mp4 放入 input\"
Write-Host "  3. .\transcribe.ps1"
