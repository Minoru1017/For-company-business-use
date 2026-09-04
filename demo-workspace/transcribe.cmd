@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "INPUT_FILE=demo.mp4"
set "MODEL=medium"
set "THREADS=8"
set "BATCH=4"

REM 簡易參數：transcribe.cmd 檔名.mp4
if not "%~1"=="" set "INPUT_FILE=%~1"

echo.
echo === DEMO 轉錄 ===

REM --- 檢查安裝 ---
if not exist ".venv\Scripts\whisperx.exe" (
    if not exist ".venv\Scripts\whisperx.cmd" (
        echo [錯誤] 尚未安裝。請先雙擊執行 setup.cmd
        pause
        exit /b 1
    )
)

REM --- 模型快取放在本資料夾 ---
set "HF_HOME=%CD%\models"
set "HUGGINGFACE_HUB_CACHE=%CD%\models\hub"
set "TORCH_HOME=%CD%\models\torch"
set "XDG_CACHE_HOME=%CD%\models"

if not exist "models" mkdir "models"
if not exist "output" mkdir "output"

REM --- 讀取 .env 的 HF_TOKEN ---
set "HF_TOKEN="
if exist ".env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
        if /i "%%a"=="HF_TOKEN" (
            set "HF_TOKEN=%%b"
            set "HF_TOKEN=!HF_TOKEN: =!"
            set "HF_TOKEN=!HF_TOKEN:"=!"
            set "HF_TOKEN=!HF_TOKEN:'=!"
        )
    )
)

if "!HF_TOKEN!"=="" (
    echo [錯誤] 請在 .env 設定 HF_TOKEN
    echo 用記事本開啟 .env ，填入：HF_TOKEN=hf_你的token
    pause
    exit /b 1
)

if "!HF_TOKEN!"=="hf_在這裡貼上你的token" (
    echo [錯誤] 請將 .env 裡的 HF_TOKEN 改成真正的 token
    pause
    exit /b 1
)

REM --- 輸入檔 ---
set "INPUT_PATH=input\%INPUT_FILE%"
if not exist "%INPUT_PATH%" (
    echo [錯誤] 找不到：%INPUT_PATH%
    echo 請將 MP4 放入 input 資料夾
    pause
    exit /b 1
)

REM --- 抽音軌 ---
set "AUDIO_FILE=%INPUT_PATH%"
for %%F in ("%INPUT_FILE%") do set "BASENAME=%%~nF"
set "WAV_PATH=input\!BASENAME!.wav"

where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo 抽取音軌 ...
    ffmpeg -y -i "%INPUT_PATH%" -vn -ac 1 -ar 16000 -c:a pcm_s16le "!WAV_PATH!"
    if not errorlevel 1 set "AUDIO_FILE=!WAV_PATH!"
) else (
    echo [提醒] 未安裝 ffmpeg，直接對 MP4 轉錄
)

echo.
echo 檔案: %INPUT_FILE%
echo 模型: %MODEL% ^| CPU int8
echo 輸出: output\
echo.
echo 2 小時 DEMO 在 CPU 筆電上約需 1.5～3 小時，請接電源。
echo.

".venv\Scripts\whisperx.exe" "!AUDIO_FILE!" ^
    --model %MODEL% ^
    --language zh ^
    --device cpu ^
    --compute_type int8 ^
    --threads %THREADS% ^
    --batch_size %BATCH% ^
    --diarize ^
    --hf_token !HF_TOKEN! ^
    --min_speakers 2 ^
    --max_speakers 2 ^
    --output_format srt ^
    --output_dir "%CD%\output"

if errorlevel 1 (
    echo.
    echo [錯誤] 轉錄失敗。請將上方紅色錯誤訊息截圖回報。
    pause
    exit /b 1
)

echo.
echo === 完成 ===
dir /b "output\*.srt" 2>nul
echo.
echo 請上傳 output 資料夾內的 .srt 至 Sales Call Coach
echo https://minoru1017.github.io/For-company-business-use/
echo.
pause
endlocal
