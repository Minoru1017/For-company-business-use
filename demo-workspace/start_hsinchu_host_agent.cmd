@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 新竹主機代理（CallCoachAssistant.exe）===
echo 會開啟圖形視窗；請按「複製 Token」貼到公司端「新竹遠端睡眠」。
echo.
if exist "CallCoachAssistant.exe" (
  CallCoachAssistant.exe --host-agent
) else if exist "runtime\python\python.exe" if exist "demo_app.py" (
  runtime\python\python.exe demo_app.py --host-agent
) else (
  python demo_app.py --host-agent
)
if errorlevel 1 pause
