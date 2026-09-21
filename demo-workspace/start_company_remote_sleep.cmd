@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 公司端 — 遠端讓新竹主機睡眠
echo （新竹須先執行 start_hsinchu_host_agent.cmd 並保持 agent 在跑）
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\company_remote_sleep.ps1" %*
if errorlevel 1 pause
