@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Call Coach 本機助手 ===
echo 資料夾: %CD%
echo.
python demo_app.py
if errorlevel 1 (
  echo.
  echo [錯誤] 無法啟動。請確認已安裝 Python 3.10+ 並加入 PATH。
  echo 也可在 CMD 執行: python demo_app.py
  pause
)
