@echo off
REM 繞過 PowerShell 指令碼執行原則限制，執行 transcribe.ps1
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0transcribe.ps1" %*
if errorlevel 1 pause
