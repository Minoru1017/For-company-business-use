---
name: call-coach-transcribe-debug
description: >-
  Call Coach DEMO 轉錄除錯：WhisperX 結束碼、進度卡在 9%、平行分段、遠端 Worker、
  Azure、日誌與 /api/job。使用者說轉錄失敗、exit 1、卡住、聽不懂狀態時必讀。
---

# Call Coach：轉錄除錯手冊

## 先分模式

| 模式 | 失敗時先看 |
|---|---|
| `local_gpu` | GPU 安裝、CUDA、`HF_TOKEN`、WhisperX 日誌、`gpu_reason` |
| `fast`/`standard` | `.venv`、CPU torch、平行分段、cp950 |
| `remote` | Worker 連線、`worker_ok`、上傳大小、Worker 日誌 `[Worker]` |
| `azure` | 金鑰、區域、ffmpeg 抽音軌 |

## 結束碼對照

| 碼 | 意義 |
|---|---|
| 0 | 成功 |
| 1 | WhisperX／ffmpeg／驗證失敗（看日誌最後 `[錯誤]` 與子程式輸出） |
| 130 | 使用者取消 |
| Windows `0xC0000005` 等 | 常為 OOM 或 native 崩潰 → `describe_exit_code` 提示 |

助手內建提示應呼叫 `whisperx_failure_hints()` 解析 OOM、cuDNN、HF gated、compute_type。

## UI 與後端狀態

- `/api/status`：`venv_ok`、`whisperx_ok`、`gpu_available`、`gpu_reason`、`local_gpu_ready`
- `/api/gpu-diagnose`：安裝後強制重跑 torch／import whisperx（清 cache）
- `/api/job`：進行中安裝／轉錄；`progress` JSON 給階段與百分比
- 日誌檔：`demo-workspace/logs/`（安裝、轉錄）；UI「複製日誌」

## 已知反覆問題與修復位置

| 現象 | 根因 | 程式位置（關鍵字） |
|---|---|---|
| 平行 DEMO ~9% 卡住 | cp950 + `Transcript:`、進度 regex 只認 `>>Performing` | `whisperx_cmd -X utf8`、`progress_tracker` |
| 遠端選檔不轉 | MP4 大小寫、worker API、probe 失敗 | `find_mp4`、`browser-worker-transcribe` |
| GPU 安裝成功仍不能轉 | CPU torch 覆蓋、float16 on RTX 50 | `setup-gpu`、`gpu_transcribe_attempts` |
| 使用者不知道安裝結果 | 無通知 | `notifyImportant`、`announceGpuSetupResult` |
| 按鈕灰掉 | `transcribeBlockReason` | 前端 checklist 對應項 |

## 請使用者提供的資訊（最少）

1. 模式（local_gpu / remote / …）
2. `VERSION.txt` 或 `api_capabilities` 片段
3. 轉錄記錄中 **`> python ... whisperx` 起至結束碼** 約 20 行（可遮 HF token）
4. 是「按鈕不能按」還是「跑一段才失敗」

## 改程式時

- 失敗訊息要 **可行動**（下一步按鈕或 .env 鍵名），不要只寫 exit 1
- GPU／安裝：**成功與失敗都要通知**（不可只依賴 opt-in 通知）
- 長片：GPU 預設不分段；OOM 用 batch 與 compute 重試，必要時再設計 CUDA 分段
