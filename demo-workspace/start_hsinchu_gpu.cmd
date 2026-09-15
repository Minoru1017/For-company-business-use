@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 新竹 GPU 主機：只用本機轉錄，不走遠端 Worker（不需網址／Token）
set "CALL_COACH_DEFAULT_MODE=local_gpu"
echo === Call Coach 新竹本機 GPU 模式 ===
echo 預設轉錄：本機 GPU（large-v3），請在網頁選「新竹本機 GPU 轉錄」
echo MP4 請放在: %CD%\input\
echo 首次請先執行 start_worker.cmd 安裝 GPU 版 WhisperX，並在 .env 填入 HF_TOKEN
echo.
call "%~dp0start_call_coach.cmd"
