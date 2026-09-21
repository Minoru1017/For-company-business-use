@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 新竹主機代理（休眠 / 狀態 / WoL 中繼）===
echo 會開啟圖形視窗，請按「複製 Token」貼到公司端「新竹遠端睡眠」。
echo 若只有黑窗：看視窗內 Token，或開啟本資料夾 .env 的 CALL_COACH_HOST_AGENT_TOKEN
echo.
if exist "CallCoachAssistant.exe" (
  CallCoachAssistant.exe --host-agent
) else if exist "runtime\python\python.exe" if exist "demo_app.py" (
  runtime\python\python.exe demo_app.py --host-agent
) else (
  python demo_app.py --host-agent
)
if errorlevel 1 pause
