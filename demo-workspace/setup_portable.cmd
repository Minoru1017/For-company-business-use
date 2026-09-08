@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Call Coach 可攜式安裝
echo ========================================
echo   Call Coach 可攜式環境安裝
echo ========================================
echo.
echo 適用：公司電腦無法執行 setup_all.cmd 時
echo   - 不需要 winget
echo   - 不需要系統管理員
echo   - Python 會放在本資料夾 runtime\python\（約 30 MB）
echo.
echo 需要：可連線 python.org（公司網路若封鎖請見下方手動方式）
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap_portable_python.ps1"
if errorlevel 1 goto :failed

echo.
echo 啟動本機轉錄助手...
call "%~dp0start_call_coach.cmd"
exit /b %ERRORLEVEL%

:failed
echo.
echo [錯誤] 可攜式 Python 安裝失敗。
echo.
echo 常見原因：
echo   - 公司封鎖 PowerShell 或下載
echo   - 無法連線 python.org
echo.
echo 手動方式（請 IT 協助或在家下載後用 USB 帶入）：
echo   1. 下載 python-3.12.7-embed-amd64.zip
echo      https://www.python.org/ftp/python/3.12.7/python-3.12.7-embed-amd64.zip
echo   2. 解壓到：%CD%\runtime\python\
echo   3. 用記事本開啟 runtime\python\python312._pth
echo      取消 #import site 前面的 # 變成 import site
echo   4. 建立資料夾 runtime\python\Lib\site-packages
echo   5. 雙擊 start_call_coach.cmd
echo.
pause
