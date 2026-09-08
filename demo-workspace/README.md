# Call Coach 本機助手（demo-workspace）

在公司電腦上執行 DEMO 錄影轉逐字稿，並與 [Call Coach](https://minoru1017.github.io/For-company-business-use/) 整合。

## 快速開始

### 方式 A：Windows 安裝精靈（推薦，公司電腦）

1. 至 [Releases](https://github.com/Minoru1017/For-company-business-use/releases/latest) 下載 **`CallCoachAssistant-Setup.exe`**
2. 執行安裝精靈（建議使用預設位置 `C:\CallCoachAssistant`）
3. 安裝過程會自動準備 **ffmpeg** 與 **WhisperX**（約 5～15 分鐘，需網路）
4. 從開始選單啟動 **Call Coach 本機助手** → Call Coach **DEMO** → 貼上 HF_TOKEN

不需 `.cmd`、不需 winget、不需自行安裝 Python。適合公司電腦封鎖腳本的情況。

### 方式 B：ZIP 免安裝版

1. 下載 **`CallCoachAssistant-Windows.zip`**
2. 解壓後雙擊 **`啟動 Call Coach.cmd`**（若公司封鎖 .cmd，請用方式 A）
3. Call Coach **DEMO** → **完整環境安裝**

### 方式 C：demo-workspace 腳本（開發者）

**公司電腦**：雙擊 **`setup_portable.cmd`**。**一般電腦**：**`setup_all.cmd`**。

1. 下載整個 `demo-workspace` 資料夾到本機
2. 依上列方式啟動，或 **`start_call_coach.cmd`**（已裝 Python 3.10～3.12）
3. 瀏覽器開啟 Call Coach → DEMO 模式 → **完整環境安裝**

## 自行打包 Windows 應用程式

在 **Windows** 上於 `demo-workspace` 目錄執行：

```powershell
.\build_windows.ps1
```

產出：`dist/CallCoachAssistant-Windows.zip`（含 `啟動 Call Coach.cmd` + 內建 Python 3.12；**不含 .exe**）。

GitHub Actions 亦會在 `main` 分支更新 `demo-workspace/` 時自動建置，可到 Actions 或 Releases 下載 artifact。

## 資料夾結構

```
demo-workspace/
├── setup_portable.cmd     ← 公司電腦用（不需 winget / 管理員）
├── setup_all.cmd          ← 一般電腦用（winget 安裝 Python/ffmpeg）
├── start_call_coach.cmd   ← 啟動（優先使用 runtime\python）
├── runtime/python/        ← 可攜式 Python（setup_portable 後產生）
├── start_call_coach.pyw
├── demo_app.py            ← 本機 API（127.0.0.1:8765）
├── demo_core.py           ← 安裝 / 轉錄 / 解除安裝邏輯
├── input/                 ← 放入 MP4
├── output/                ← 轉完的 SRT
├── .env                   ← HF_TOKEN（勿分享）
├── .venv/                 ← WhisperX 環境（一鍵安裝後產生）
└── models/                ← AI 模型快取（約 3～6 GB）
```

## 兩種工作流程

| 模式 | 用途 | 操作 |
|------|------|------|
| **開發 · 電訪** | Vibe 錄音 < 20 分鐘 | 匯出 `.vibe.json` 上傳 Call Coach |
| **DEMO · 錄影** | 1～2 小時 MP4 | 本機轉錄後自動載入分析 |

電訪模式不需啟動本機助手；DEMO 模式需保持 `start_call_coach` 視窗開啟。

## HF_TOKEN

首次 DEMO 轉錄需 Hugging Face Read Token（用於辨識誰在說話）。在 Call Coach DEMO 模式按「前往取得 Token」，或至 https://huggingface.co/settings/tokens 建立。

需同意三個 pyannote 模型授權（community-1、diarization-3.1、segmentation-3.0）。

## 疑難排解

- **CallCoachAssistant.exe / python312.dll 錯誤**：代表使用了**舊版**或點錯檔案。刪除整個資料夾，下載最新 Releases，只雙擊 **`啟動 Call Coach.cmd`**。若資料夾內有 `_internal` 即為舊版
- **完整環境安裝出現 Failed to fetch**：請確認 `CallCoachAssistant.cmd` 黑窗仍開啟，並下載 [最新版 Releases](https://github.com/Minoru1017/For-company-business-use/releases/latest)。若仍失敗，改按「僅安裝 WhisperX」
- **雙擊 start_call_coach 沒反應**：改用 `setup_portable.cmd` 或 `start_call_coach.cmd`（命令指令檔，不是 .pyw）
- **Call Coach 顯示未連線**：確認助手黑窗仍開啟；若使用 **Python 3.13/3.14**，請執行 **`setup_portable.cmd`** 安裝內建 Python 3.12
- **大檔 MP4 很慢**：建議手動複製到 `input\`，再按「重新掃描」
- **轉錄失敗**：查看 Call Coach 下方日誌；常見為 Token 未設定或 ffmpeg 未安裝（`winget install Gyan.FFmpeg`）
- **一鍵安裝失敗**：在 Call Coach 按「複製日誌」或「下載日誌」，或開啟 `logs\` 資料夾將 `.log` 檔傳給技術支援
- **解除安裝**：在 DEMO 模式按「解除安裝轉錄環境」
