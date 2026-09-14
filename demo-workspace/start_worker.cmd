@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === Call Coach 遠端轉錄 Worker（家用 GPU 主機用）===
echo 資料夾: %CD%
echo.

set "PY_CMD="
if exist "%~dp0runtime\python\python.exe" set "PY_CMD=%~dp0runtime\python\python.exe"
if not defined PY_CMD where py >nul 2>&1 && set "PY_CMD=py -3"
if not defined PY_CMD where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD where python3 >nul 2>&1 && set "PY_CMD=python3"
if not defined PY_CMD goto :no_python
echo 使用: %PY_CMD%

if /i "%~1"=="reinstall" goto :setup
if not exist "%~dp0.venv\Scripts\python.exe" goto :setup
goto :run

:setup
echo.
echo [安裝] 尚未安裝 GPU 版 WhisperX，開始安裝（CUDA 12.8 版 PyTorch 約 2.5 GB，首次 10～20 分鐘）…
echo        RTX 50 系列（Blackwell）必須使用 CUDA 12.8 版，請保持網路連線。
echo.
"%PY_CMD%" demo_app.py --setup-gpu
if errorlevel 1 goto :failed
echo.
echo [提醒] 若尚未填 HF_TOKEN，請開啟 .env 貼上 Hugging Face Token（分軌模型授權需要）。
echo.

:run
echo [提示] Worker 啟動後此黑窗會一直開著 — 請勿關閉。視窗會顯示公司電腦要填的「網址」與「Token」。
echo        重新安裝 GPU 版：start_worker.cmd reinstall
echo.
"%PY_CMD%" demo_app.py --worker --console
if errorlevel 1 goto :failed
exit /b 0

:no_python
echo [錯誤] 找不到 Python — Worker 需要 Python 3.10～3.12。
echo 可先執行 setup_portable.cmd 安裝內建 Python 3.12，或至 https://www.python.org/downloads/ 下載。
goto :pause

:failed
echo.
echo [錯誤] 執行失敗。常見原因：Python 版本過新（請用 3.10～3.12）、網路中斷、磁碟空間不足（需約 6 GB）。
echo 請把上方輸出截圖或複製給技術支援。
goto :pause

:pause
echo.
pause
