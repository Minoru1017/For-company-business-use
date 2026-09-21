@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 新竹本機測試「通話錄音一條龍」（無公司分享碟時用本機資料夾）
rem 請在 MicroSIP：設定 → 錄音 → 錄音目錄 指到下方同一個資料夾

set "CALL_COACH_DEFAULT_MODE=local_gpu"
set "CALL_COACH_PREFER_GPU=1"
set "CALL_COACH_RECORDINGS_WATCH=1"
set "RECORD_DIR=%~dp0recordings-watch"
if not exist "%RECORD_DIR%" mkdir "%RECORD_DIR%"
set "CALL_COACH_RECORDINGS_DIR=%RECORD_DIR%"

echo.
echo === 新竹 · 通話錄音一條龍（本機測試）===
echo 監看資料夾: %CALL_COACH_RECORDINGS_DIR%
echo.
echo [MicroSIP] 請將「錄音目錄」設成與上面完全相同的路徑，並開啟「通話錄音」。
echo [測試] 正式門檻為通話 ^>=5 分鐘；快速試跑可在 .env 加：
echo        CALL_COACH_RECORDINGS_MIN_SECONDS=60
echo        CALL_COACH_RECORDINGS_POLL_SECONDS=45
echo [手動] 也可把已完成的 .wav 複製到監看資料夾，等約 15 秒後助手會掃描。
echo.
echo 需要助手 11.9.6+（api_capabilities 含 recording-pipeline）。
echo.

call "%~dp0start_hsinchu_gpu.cmd" %*
exit /b %ERRORLEVEL%
