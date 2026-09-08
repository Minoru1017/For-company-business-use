@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Call Coach 本機助手 ===
echo 資料夾: %CD%
echo.

set "PY_CMD="
where py >nul 2>&1 && set "PY_CMD=py -3"
if not defined PY_CMD where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD where python3 >nul 2>&1 && set "PY_CMD=python3"

if not defined PY_CMD goto :no_python

echo 使用: %PY_CMD%
echo.
echo [提示] 若成功，此黑窗會一直開著 — 請勿關閉，並回到 Call Coach 重新整理。
echo.
%PY_CMD% demo_app.py
if errorlevel 1 goto :failed
exit /b 0

:no_python
echo [錯誤] 找不到 Python — 本機助手需要先安裝 Python 3.10 或以上。
echo.
echo 安裝步驟（Windows）：
echo   1. 開啟 https://www.python.org/downloads/
echo   2. 下載 Python 3.12 或 3.11
echo   3. 安裝時務必勾選「Add python.exe to PATH」
echo   4. 安裝完成後關閉此視窗，再雙擊 start_call_coach.cmd
echo.
echo 若已安裝仍失敗：在資料夾網址列輸入 cmd，執行 python --version 確認。
goto :pause

:failed
echo.
echo [錯誤] 啟動失敗。請確認 Python 3.10+ 已安裝且可執行。
echo 可在 CMD 執行: python demo_app.py
goto :pause

:pause
echo.
pause
