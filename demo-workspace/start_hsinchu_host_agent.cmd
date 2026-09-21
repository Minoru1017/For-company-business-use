@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 新竹主機代理（休眠 / 狀態 / WoL 中繼）===
echo 請把視窗上的 Host Token 填到公司端「新竹主機喚醒」App。
echo.
if exist "CallCoachAssistant.exe" (
  CallCoachAssistant.exe --host-agent
) else (
  python demo_app.py --host-agent
)
pause
