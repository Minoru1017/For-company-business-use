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

REM --- 檢查 Python ---
where python >nul 2>&1
if errorlevel 1 (
    echo [錯誤] 找不到 python 指令。
    echo.
    echo 請先安裝 Python 3.10 或 3.11：
    echo   https://www.python.org/downloads/
    echo 安裝時務必勾選 「Add python.exe to PATH」
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do set PYVER=%%v
echo Python %PYVER% OK

REM --- 建立虛擬環境 ---
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

REM --- 安裝套件（直接用 .venv\python，不需 activate.ps1）---
echo.
echo 升級 pip ...
".venv\Scripts\python.exe" -m pip install -U pip wheel
if errorlevel 1 (
    echo [錯誤] pip 升級失敗
    pause
    exit /b 1
)

echo.
echo 安裝 whisperx（首次約 5～15 分鐘，需網路）...
".venv\Scripts\python.exe" -m pip install whisperx
if errorlevel 1 (
    echo.
    echo [錯誤] whisperx 安裝失敗。
    echo 若公司網路有限制，請連手機熱點後再試，或請 IT 協助。
    pause
    exit /b 1
)

REM --- .env ---
if not exist ".env" (
    copy /Y ".env.example" ".env" >nul
    echo.
    echo 已建立 .env — 請用記事本開啟並填入 HF_TOKEN
)

REM --- ffmpeg ---
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo.
    echo [提醒] 找不到 ffmpeg。請在命令提示字元執行：
    echo   winget install Gyan.FFmpeg
    echo 安裝後關閉視窗重開，再執行 transcribe.cmd
) else (
    echo ffmpeg OK
)

echo.
echo === 安裝完成 ===
echo.
echo 下一步：
echo   1. 用記事本開啟 .env ，填入 HF_TOKEN=hf_你的token
echo   2. 到網頁接受授權：https://huggingface.co/pyannote/speaker-diarization-community-1
echo   3. 將 demo.mp4 放入 input 資料夾
echo   4. 雙擊執行 transcribe.cmd
echo.
pause
endlocal
