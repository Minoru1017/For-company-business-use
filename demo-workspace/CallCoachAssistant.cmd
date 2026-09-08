@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Call Coach 本機助手

set "PY=%~dp0runtime\python\python.exe"
if not exist "%PY%" (
  echo [錯誤] 找不到 runtime\python\python.exe
  echo 請重新解壓完整的 CallCoachAssistant-Windows.zip
  goto :pause
)

echo === Call Coach 本機助手 ===
echo 資料夾: %CD%
echo.
echo 使用內建 Python 啟動（支援中文使用者名稱路徑）。
echo 若 CallCoachAssistant.exe 出現 python312.dll 錯誤，請一律使用此檔案啟動。
echo.
echo [提示] 請保持此視窗開啟。關閉即停止服務。
echo.
"%PY%" demo_app.py
if errorlevel 1 goto :pause
exit /b 0

:pause
echo.
pause
