@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo === DEMO Workspace 安裝 ===
echo 資料夾: %CD%
echo.

if not exist "models" mkdir "models"
if not exist "input" mkdir "input"
if not exist "output" mkdir "output"

where python >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 找不到 python。請安裝 Python 3.10+ 並勾選 Add to PATH
    echo https://www.python.org/downloads/
    pause
    exit /b 1
)

for /f "delims=" %%v in ('python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do set PYVER=%%v
echo Python %PYVER% OK

if not exist ".venv\Scripts\python.exe" (
    echo.
    echo 建立虛擬環境 .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [錯誤] 無法建立 .venv
        pause
        exit /b 1
    )
)

echo.
echo 升級 pip ...
".venv\Scripts\python.exe" -m pip install -U pip wheel
if errorlevel 1 goto :fail

echo.
echo 安裝 whisperx 與 huggingface_hub（首次約 5～15 分鐘）...
".venv\Scripts\python.exe" -m pip install whisperx huggingface_hub
if errorlevel 1 goto :fail

if not exist ".env" (
    copy /Y ".env.example" ".env" >nul
    echo.
    echo 已建立 .env — 請用記事本填入 HF_TOKEN
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo.
    echo [提醒] 找不到 ffmpeg，請執行: winget install Gyan.FFmpeg
) else (
    echo ffmpeg OK
)

echo.
echo === 安裝完成 ===
echo.
echo 下一步：
echo   1. 記事本開啟 .env ，填入 HF_TOKEN=hf_你的token
echo   2. 雙擊「一鍵轉錄.bat」或把 MP4 拖到「拖放轉錄.bat」
echo.
pause
exit /b 0

:fail
echo.
echo [錯誤] 安裝失敗。可試手機熱點或請 IT 協助網路。
pause
exit /b 1
