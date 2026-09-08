# Call Coach 本機助手（demo-workspace）

在公司電腦上執行 DEMO 錄影轉逐字稿，並與 [Call Coach](https://minoru1017.github.io/For-company-business-use/) 整合。

## 快速開始

**必要條件：本機需安裝 [Python 3.10+](https://www.python.org/downloads/)**（Windows 安裝時請勾選 **Add python.exe to PATH**）。

1. 下載整個 `demo-workspace` 資料夾到本機（例如 `C:\Users\經銷業務\demo-workspace`）
2. 雙擊 **`start_call_coach.cmd`**（首次建議用這個；若缺 Python 會顯示安裝指引）或 `start_call_coach.pyw`
3. 瀏覽器開啟 Call Coach → 選擇 **DEMO · 錄影轉逐字稿**
4. 一鍵安裝 → 設定 Token → 放入 MP4 → 開始轉錄 → 自動進入分析

## 資料夾結構

```
demo-workspace/
├── start_call_coach.pyw   ← 啟動（推薦）
├── start_call_coach.cmd
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

- **雙擊 start_call_coach 沒反應**：多半未安裝 Python，或安裝時未勾選 PATH。請改雙擊 `start_call_coach.cmd` 查看錯誤；或安裝 [Python 3.10+](https://www.python.org/downloads/) 後重試
- **Call Coach 顯示未連線**：確認 `start_call_coach` 視窗仍開啟，重新整理頁面
- **大檔 MP4 很慢**：建議手動複製到 `input\`，再按「重新掃描」
- **轉錄失敗**：查看 Call Coach 下方日誌；常見為 Token 未設定或 ffmpeg 未安裝（`winget install Gyan.FFmpeg`）
- **解除安裝**：在 DEMO 模式按「解除安裝轉錄環境」
