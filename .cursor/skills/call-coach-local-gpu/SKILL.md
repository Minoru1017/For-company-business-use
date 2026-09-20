---
name: call-coach-local-gpu
description: >-
  Call Coach 新竹本機 GPU 轉錄（local_gpu）：WhisperX CUDA、RTX 50/5070、setup-gpu、
  與遠端 Worker 區分、安裝通知與轉錄 exit 1。使用者提到 GPU 版、新竹、RTX、CUDA、
  start_hsinchu_gpu、本機 GPU 模式時必讀。
---

# Call Coach：新竹本機 GPU（local_gpu）

## 兩條產品線（最常搞混）

| | 新竹本機 GPU `local_gpu` | 遠端 Worker `remote` |
|---|---|---|
| 誰用 | 坐在 GPU 電腦前 | 公司 PC 上傳到新竹 |
| 開什麼 | `start_call_coach.cmd` / `start_hsinchu_gpu.cmd` → **本機助手** | 新竹開 **Worker**（`start_worker.cmd` 或 exe `--worker`） |
| 網路 | 音訊不上傳 | 音訊上傳到 Worker |
| 網頁模式 | 「新竹本機 GPU 轉錄」 | 「遠端主機轉錄」 |

**Worker 黑窗 ≠ 本機轉錄助手。** 只開 Worker 時，Call Coach 網頁無法完成本機 GPU 轉錄。

## 兩條更新線（最常以為 exe 沒更新）

| 變更位置 | 影響 | 使用者要做什麼 |
|---|---|---|
| `src/`、`index.html`（GitHub Pages） | 網頁 UI、開發重點、通知 | **Ctrl+F5** 強刷，不必重裝 exe |
| `demo-workspace/**`（CI `build-assistant.yml`） | `CallCoachAssistant-Setup.exe`、API | 下載 [Releases latest](https://github.com/Minoru1017/For-company-business-use/releases/latest) 覆蓋安裝 |

確認助手版本：`C:\CallCoachAssistant\VERSION.txt` 或 `http://127.0.0.1:8765/api/status` 的 `api_capabilities`（應含 `setup-gpu`、`gpu-diagnose`）。

## GPU 安裝（反覆踩雷）

1. **「完整環境安裝」會裝 CPU 版 PyTorch**，覆蓋 CUDA。新竹請用：
   - 網頁：「安裝 GPU 版 WhisperX」→ `/api/setup-gpu` 或 `full-setup-gpu`
   - CMD：`start_hsinchu_gpu.cmd reinstall` 或 `demo_app.py --setup-gpu`
2. **Setup.exe 曾未打包** `start_hsinchu_gpu.cmd`（見 `build_windows.ps1` 的 `$AppFiles`）；安裝後目錄應有該 cmd。
3. 安裝結束應有 **強制通知**（`notifyImportant`）：成功須同時 **WhisperX + gpu_available**；exit 0 但 CUDA 未就緒要明說。

## RTX 50 / 5070 轉錄 exit 1

- 預設對 Blackwell 用 `compute_type=int8`（見 `gpu_whisper_compute_type`、`gpu_transcribe_attempts`）。
- `.env` 可覆寫：
  - `CALL_COACH_GPU_COMPUTE=int8` 或 `float32`
  - `CALL_COACH_GPU_BATCH=4`（長 DEMO / 顯存不足）
- 失敗時看日誌：`> python -X utf8 -m whisperx` 之後最後 20 行；常見 HF 分軌授權、OOM、cuDNN。
- Windows 主控台：子程式用 `python -X utf8 -m whisperx`，避免 cp950 殺掉 WhisperX。

## 實作檢查清單（改 code 時）

- [ ] `run_full_setup` 在 `CALL_COACH_DEFAULT_MODE=local_gpu` 或 `PREFER_GPU` 時走 `gpu=True`
- [ ] 前端 `local_gpu` 的 fix 按鈕指向 `setup-gpu`，不是 `full-setup`
- [ ] `worker_server` 與 `demo_core` 共用 `gpu_whisper_compute_type`
- [ ] 安裝／轉錄完成有 toast + 桌面通知或 alert（GPU 安裝不可只靠可選「完成時通知」）
- [ ] 測試：`test_gpu_setup.py`、必要時 `test_transcribe_parallel.py`

## 給使用者的最短話術

「請雙擊 `start_hsinchu_gpu.cmd` 開**本機助手**（不要只開 Worker），網頁選**新竹本機 GPU**，`.env` 填 `HF_TOKEN`；GPU 環境用 **安裝 GPU 版** 或 `reinstall`，不要用一般完整安裝覆蓋 CUDA。」
