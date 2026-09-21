@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 若找不到 start_hsinchu_host_agent.cmd，用本檔或下列指令即可。
if exist "start_hsinchu_host_agent.cmd" (
  call "start_hsinchu_host_agent.cmd"
  exit /b %ERRORLEVEL%
)
if exist "runtime\python\python.exe" if exist "demo_app.py" (
  runtime\python\python.exe demo_app.py --host-agent
  exit /b %ERRORLEVEL%
)
if exist "CallCoachAssistant.exe" (
  CallCoachAssistant.exe --host-agent
  exit /b %ERRORLEVEL%
)
echo [錯誤] 請更新 Call Coach 助手至最新 Release，或從 GitHub 複製 start_hsinchu_host_agent.cmd 到此資料夾。
pause
exit /b 1
