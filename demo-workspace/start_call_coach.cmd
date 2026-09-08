@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Call Coach 本機助手 ===
echo 資料夾: %CD%
echo.

set "PY_CMD="
if exist "%~dp0runtime\python\python.exe" set "PY_CMD=%~dp0runtime\python\python.exe"
if not defined PY_CMD where py >nul 2>&1 && set "PY_CMD=py -3"
if not defined PY_CMD where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD where python3 >nul 2>&1 && set "PY_CMD=python3"

if not defined PY_CMD goto :no_python

echo 使用: %PY_CMD%
for /f "delims=" %%v in ('"%PY_CMD%" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"') do set "PY_VER=%%v"
echo Python: %PY_VER%
for /f "delims=" %%w in ('"%PY_CMD%" -c "import sys; print(1 if sys.version_info[:2] > (3,12) else 0)"') do set "PY_NEW=%%w"
if "%PY_NEW%"=="1" (
  echo.
  echo [提醒] Python %PY_VER% 過新，WhisperX 建議 3.10～3.12。
  echo        請執行 setup_portable.cmd 安裝內建 Python 3.12。
  echo.
)
echo [提示] 若成功，此黑窗會一直開著 — 請勿關閉，並回到 Call Coach 重新整理。
echo.
"%PY_CMD%" demo_app.py
if errorlevel 1 goto :failed
exit /b 0

:no_python
echo [錯誤] 找不到 Python — 本機助手需要 Python 3.10～3.12。
echo.
echo 公司電腦請先試：setup_portable.cmd（不需 winget / 管理員）
echo 一般電腦可試：setup_all.cmd
echo 或至 https://www.python.org/downloads/ 下載 Python 3.12
goto :pause

:failed
echo.
echo [錯誤] 啟動失敗。請確認 Python 3.10～3.12 已安裝且可執行。
echo 可在 CMD 執行: python demo_app.py
goto :pause

:pause
echo.
pause
