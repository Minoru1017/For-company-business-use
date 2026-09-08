@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Call Coach 本機助手

if exist "%~dp0_internal" (
  echo.
  echo [錯誤] 這是舊版安裝（含 _internal 資料夾），無法在此路徑使用 .exe。
  echo.
  echo 請：1. 刪除整個 CallCoachAssistant 資料夾
  echo      2. 至 GitHub Releases 下載最新 CallCoachAssistant-Windows.zip
  echo      3. 解壓後只雙擊「啟動 Call Coach.cmd」（不要用 .exe）
  echo.
  goto :pause
)

set "PY=%~dp0runtime\python\python.exe"
if not exist "%PY%" (
  echo [錯誤] 找不到 runtime\python\python.exe
  echo 請重新下載並解壓完整的 CallCoachAssistant-Windows.zip（v11.0.2 以上）
  goto :pause
)

if not exist "%~dp0demo_app.py" (
  echo [錯誤] 找不到 demo_app.py — 您可能仍在使用舊版 zip。
  echo 請刪除本資料夾，重新下載最新版 Releases。
  goto :pause
)

echo === Call Coach 本機助手 ===
echo 資料夾: %CD%
echo.
echo [重要] 請保持此黑窗開啟。關閉即停止服務。
echo [重要] 請勿雙擊 CallCoachAssistant.exe（中文路徑會失敗）。
echo.
"%PY%" demo_app.py
if errorlevel 1 goto :pause
exit /b 0

:pause
echo.
pause
