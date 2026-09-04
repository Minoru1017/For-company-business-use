@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "MODEL=medium"
set "THREADS=8"
set "BATCH=4"
set "INPUT_FILE="

REM 參數：transcribe.cmd 檔名.mp4
if not "%~1"=="" set "INPUT_FILE=%~1"

echo.
echo === DEMO 轉錄 ===

if not exist ".venv\Scripts\whisperx.exe" (
    if not exist ".venv\Scripts\python.exe" (
        echo [錯誤] 尚未安裝。請先雙擊「安裝.bat」
        pause
        exit /b 1
    )
    echo [錯誤] whisperx 未安裝。請先雙擊「安裝.bat」
    pause
    exit /b 1
)

set "HF_HOME=%CD%\models"
set "HUGGINGFACE_HUB_CACHE=%CD%\models\hub"
set "TORCH_HOME=%CD%\models\torch"
set "XDG_CACHE_HOME=%CD%\models"
set "HF_TOKEN="

if not exist "models" mkdir "models"
if not exist "input" mkdir "input"
if not exist "output" mkdir "output"

REM 讀取 .env
if exist ".env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
        if /i "%%a"=="HF_TOKEN" (
            set "HF_TOKEN=%%b"
            set "HF_TOKEN=!HF_TOKEN: =!"
            set "HF_TOKEN=!HF_TOKEN:"=!"
        )
    )
)

if "!HF_TOKEN!"=="" (
    echo [錯誤] 請在 .env 設定 HF_TOKEN=hf_你的token
    notepad .env
    pause
    exit /b 1
)

REM 自動找 input 裡的 MP4（若未指定檔名）
if "!INPUT_FILE!"=="" if exist "input\demo.mp4" set "INPUT_FILE=demo.mp4"

if "!INPUT_FILE!"=="" (
    for /f "delims=" %%f in ('dir /b /o-d "input\*.mp4" 2^>nul') do (
        set "INPUT_FILE=%%f"
        goto :found_mp4
    )
)
:found_mp4

if "!INPUT_FILE!"=="" (
    echo [錯誤] input 資料夾沒有 MP4 檔
    echo 請將錄影放入 input\ 或使用「拖放轉錄.bat」
    pause
    exit /b 1
)

set "INPUT_PATH=input\!INPUT_FILE!"
if not exist "!INPUT_PATH!" (
    echo [錯誤] 找不到 !INPUT_PATH!
    pause
    exit /b 1
)

REM 修正 demo.mp4.mp4 雙副檔名
echo !INPUT_FILE! | findstr /i "\.mp4\.mp4$" >nul
if not errorlevel 1 (
  echo [提醒] 偵測到雙副檔名，將使用: !INPUT_FILE!
)

for %%F in ("!INPUT_FILE!") do set "BASENAME=%%~nF"
set "WAV_PATH=input\!BASENAME!.wav"
set "AUDIO_FILE=!INPUT_PATH!"

where ffmpeg >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [1/2] 抽取音軌 ...
    ffmpeg -y -hide_banner -loglevel error -i "!INPUT_PATH!" -vn -ac 1 -ar 16000 -c:a pcm_s16le "!WAV_PATH!"
    if not errorlevel 1 set "AUDIO_FILE=!WAV_PATH!"
) else (
    echo [提醒] 未安裝 ffmpeg，直接對 MP4 轉錄
)

echo.
echo [2/2] 開始轉錄（請接電源，勿關閉視窗）
echo 檔案: !INPUT_FILE!
echo 模型: %MODEL%
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
    echo [錯誤] 轉錄失敗。常見原因：HF_TOKEN 無效或未同意 pyannote 三個模型授權
    pause
    exit /b 1
)

echo.
echo === 完成 ===
for %%s in (output\*.srt) do echo 逐字稿: %%~fs
echo.
echo 上傳 output 內的 .srt 至 Call Coach:
echo https://minoru1017.github.io/For-company-business-use/
echo.
pause
endlocal
