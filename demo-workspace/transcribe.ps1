#Requires -Version 5.1
<#
.SYNOPSIS
  轉錄 input\ 內的 DEMO 錄影為 SRT（本機、不上雲）。

.PARAMETER InputFile
  檔名（預設 demo.mp4），放在 input\ 資料夾內。

.PARAMETER Model
  Whisper 模型（預設 medium，適合 Intel 內顯 CPU 筆電）。

.EXAMPLE
  .\transcribe.ps1
  .\transcribe.ps1 -InputFile "客戶A.mp4" -Model medium
#>
param(
    [string]$InputFile = "demo.mp4",
    [ValidateSet("tiny", "base", "small", "medium", "large-v2", "large-v3", "large-v3-turbo")]
    [string]$Model = "medium",
    [int]$Threads = 8,
    [int]$BatchSize = 4,
    [switch]$SkipExtract
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location $Root

# 啟用虛擬環境
$activate = Join-Path $Root ".venv\Scripts\Activate.ps1"
if (-not (Test-Path $activate)) {
    throw "尚未安裝。請先執行 .\setup.ps1"
}
. $activate

# 模型快取固定在專案內
$env:HF_HOME = Join-Path $Root "models"
$env:HUGGINGFACE_HUB_CACHE = Join-Path $Root "models\hub"
$env:TORCH_HOME = Join-Path $Root "models\torch"
$env:XDG_CACHE_HOME = Join-Path $Root "models"

# 載入 .env
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.+?)\s*$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim().Trim('"').Trim("'")
            if ($name -and $value -and $value -notmatch '^hf_在這裡') {
                Set-Item -Path "env:$name" -Value $value
            }
        }
    }
}

if (-not $env:HF_TOKEN) {
    throw "請在 .env 設定 HF_TOKEN（執行 setup.ps1 會建立範本）"
}

# 輸入檔
$inputPath = Join-Path $Root "input\$InputFile"
if (-not (Test-Path $inputPath)) {
    throw "找不到輸入檔: $inputPath`n請將 MP4 放入 input\ 資料夾。"
}

$outputDir = Join-Path $Root "output"
if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir | Out-Null }

$baseName = [System.IO.Path]::GetFileNameWithoutExtension($InputFile)
$wavPath = Join-Path $Root "input\$baseName.wav"
$audioForWhisper = $inputPath

# 抽音軌（可選，減輕 MP4 解碼負擔）
if (-not $SkipExtract) {
    if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
        Write-Warning "未安裝 ffmpeg，直接對 MP4 轉錄。"
    } else {
        Write-Host "抽取音軌 → input\$baseName.wav"
        & ffmpeg -y -i $inputPath -vn -ac 1 -ar 16000 -c:a pcm_s16le $wavPath
        if ($LASTEXITCODE -ne 0) { throw "ffmpeg 失敗" }
        $audioForWhisper = $wavPath
    }
}

Write-Host ""
Write-Host "=== 開始轉錄 ===" -ForegroundColor Cyan
Write-Host "檔案: $InputFile"
Write-Host "模型: $Model | CPU int8 | threads=$Threads"
Write-Host "輸出: output\"
Write-Host "（2 小時 DEMO 在 CPU 筆電上可能需 1.5～3 小時，請接電源並關閉其他程式）"
Write-Host ""

whisperx $audioForWhisper `
    --model $Model `
    --language zh `
    --device cpu `
    --compute_type int8 `
    --threads $Threads `
    --batch_size $BatchSize `
    --diarize `
    --hf_token $env:HF_TOKEN `
    --min_speakers 2 `
    --max_speakers 2 `
    --output_format srt `
    --output_dir $outputDir

if ($LASTEXITCODE -ne 0) { throw "whisperx 轉錄失敗（結束碼 $LASTEXITCODE）" }

Write-Host ""
Write-Host "=== 完成 ===" -ForegroundColor Green
Get-ChildItem $outputDir -Filter "*.srt" | ForEach-Object {
    Write-Host "逐字稿: $($_.FullName)"
}
Write-Host ""
Write-Host "請上傳 .srt 至 Sales Call Coach，確認 SPEAKER_00=顧問、SPEAKER_01=客戶。"
