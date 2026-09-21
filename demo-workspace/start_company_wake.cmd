@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 公司端：新竹主機喚醒 + DeskIn ===
if exist "CallCoachCompanyWake.exe" (
  start "" "CallCoachCompanyWake.exe"
) else if exist "CallCoachAssistant.exe" (
  start "" "CallCoachAssistant.exe" --company-wake
) else (
  python company_wake_app.py
)
