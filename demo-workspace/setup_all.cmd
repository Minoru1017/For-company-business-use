@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Call Coach 一鍵安裝
echo ========================================
echo   Call Coach DEMO 一鍵安裝環境
echo ========================================
echo.
echo 將自動安裝（若尚未安裝）：
echo   - Python 3.12
echo   - ffmpeg
echo 然後啟動本機轉錄助手。
echo.
echo 需要網路連線；安裝 Python/ffmpeg 時可能跳出系統確認視窗。
echo.

set "NEED_PATH_REFRESH=0"

where py >nul 2>&1 || where python >nul 2>&1 || (
  echo [1/3] 正在安裝 Python 3.12...
  where winget >nul 2>&1 || goto :no_winget
  winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :install_failed
  set "NEED_PATH_REFRESH=1"
  echo.
)

where ffmpeg >nul 2>&1 || (
  echo [2/3] 正在安裝 ffmpeg...
  where winget >nul 2>&1 || goto :no_winget
  winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements
  if errorlevel 1 goto :install_failed
  set "NEED_PATH_REFRESH=1"
  echo.
)

if "%NEED_PATH_REFRESH%"=="1" (
  echo [提醒] 剛安裝完 Python/ffmpeg，若下一步失敗請關閉此視窗後再雙擊一次。
  echo.
)

echo [3/3] 啟動本機轉錄助手...
call "%~dp0start_call_coach.cmd"
exit /b %ERRORLEVEL%

:no_winget
echo [錯誤] 找不到 winget。請確認為 Windows 10/11 且已安裝「應用程式安裝程式」。
echo 或手動安裝 Python 3.10+ 與 ffmpeg 後，雙擊 start_call_coach.cmd
goto :pause

:install_failed
echo [錯誤] 自動安裝失敗。請以系統管理員身分執行，或手動安裝後改用 start_call_coach.cmd
goto :pause

:pause
echo.
pause
