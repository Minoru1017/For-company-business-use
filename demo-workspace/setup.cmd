@echo off
REM 繞過 PowerShell 指令碼執行原則限制，執行 setup.ps1
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
if errorlevel 1 pause
