@echo off
REM 通話錄音一條龍：監看 CALL_COACH_RECORDINGS_DIR 內的新 WAV（請先在 .env 設定路徑）
setlocal
cd /d "%~dp0"
set "CALL_COACH_RECORDINGS_WATCH=1"
if exist "CallCoachAssistant.exe" (
  start "" "CallCoachAssistant.exe" --assistant
) else if exist "start_call_coach.cmd" (
  call "%~dp0start_call_coach.cmd"
) else (
  echo 請在此資料夾安裝 Call Coach 本機助手，或執行 python demo_app.py
  pause
)
