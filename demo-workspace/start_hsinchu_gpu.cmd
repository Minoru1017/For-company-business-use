@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 新竹 GPU 主機：本機助手 + 本機 GPU 轉錄（不走遠端 Worker）
set "CALL_COACH_DEFAULT_MODE=local_gpu"
set "CALL_COACH_PREFER_GPU=1"

set "PY_CMD="
if exist "%~dp0runtime\python\python.exe" set "PY_CMD=%~dp0runtime\python\python.exe"
if not defined PY_CMD where py >nul 2>&1 && set "PY_CMD=py -3"
if not defined PY_CMD where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD where python3 >nul 2>&1 && set "PY_CMD=python3"
if not defined PY_CMD goto :no_python

if /i "%~1"=="reinstall" goto :setup
if not exist "%~dp0.venv\Scripts\python.exe" goto :setup
goto :run

:setup
echo.
echo [安裝] GPU 版 WhisperX（CUDA 12.8 PyTorch，約 2.5 GB；RTX 50 需此版本）…
echo        重新安裝：start_hsinchu_gpu.cmd reinstall
echo.
"%PY_CMD%" demo_app.py --setup-gpu
if errorlevel 1 goto :failed
echo.
echo [提醒] 請在 .env 填入 HF_TOKEN，並確認 NVIDIA 驅動為 570+（更新後建議重開機）。
echo.

:run
echo === Call Coach 新竹本機 GPU 模式 ===
echo 預設轉錄：新竹本機 GPU（large-v3）
echo MP4 請放在: %CD%\input\
echo 請在 Call Coach 網頁選「新竹本機 GPU 轉錄」後開始（勿選遠端主機模式）。
echo 本視窗是「本機助手」，不是 Worker — 公司電腦遠端轉錄才需要 start_worker.cmd。
echo.
call "%~dp0start_call_coach.cmd"
exit /b %ERRORLEVEL%

:no_python
echo [錯誤] 找不到 Python — 請先執行 setup_portable.cmd 或安裝 Python 3.12。
goto :pause

:failed
echo [錯誤] GPU 版安裝失敗，請複製上方輸出給技術支援。
goto :pause

:pause
pause
exit /b 1
