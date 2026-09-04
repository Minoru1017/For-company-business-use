@echo off
REM 拖放 MP4 到此檔案上即可轉錄
chcp 65001 >nul 2>&1
cd /d "%~dp0"

if "%~1"=="" (
    echo.
    echo 用法：把 MP4 錄影檔「拖放到」此檔案上
    echo 或：拖放轉錄.bat "你的檔案.mp4"
    echo.
    pause
    exit /b 1
)

if not exist "input" mkdir "input"

echo 複製錄影到 input 資料夾 ...
copy /Y "%~1" "input\%~nx1" >nul
if errorlevel 1 (
    echo [錯誤] 無法複製檔案
    pause
    exit /b 1
)

call "%~dp0transcribe.cmd" "%~nx1"
