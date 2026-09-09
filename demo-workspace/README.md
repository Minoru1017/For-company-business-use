# Call Coach 本機助手（demo-workspace）

在公司電腦上執行 DEMO 錄影轉逐字稿，並與 [Call Coach](https://minoru1017.github.io/For-company-business-use/) 整合。

## 快速開始

### 方式 A：Windows 安裝精靈（推薦，公司電腦）

1. 至 [Releases](https://github.com/Minoru1017/For-company-business-use/releases/latest) 下載 **`CallCoachAssistant-Setup.exe`**
2. 若主管有給你 **`team-config.env`**，放在 Setup.exe **旁邊**再執行（精靈會自動帶入、並取消勾選 WhisperX 下載）
3. 執行安裝精靈（建議使用預設位置 `C:\CallCoachAssistant`）；「轉錄引擎」頁可勾選是否安裝 **WhisperX**（約 1～3 GB）
4. 從開始選單啟動 **Call Coach 本機助手** → 網頁 **DEMO** 會顯示「首次啟動檢查」，缺什麼就按旁邊的按鈕補齊

不需 `.cmd`、不需 winget、不需自行安裝 Python。適合公司電腦封鎖腳本的情況。

### 零門檻路徑：Azure 雲端轉錄（團隊預設）

有 `team-config.env`（或自行填入 Azure 金鑰）時，DEMO 轉錄預設走 **Azure Speech Fast Transcription**：

- **不需** Hugging Face Token、**不需**下載 WhisperX / 模型、**不受** Smart App Control 影響（只用到 ffmpeg 抽音軌）
- 48 分鐘 DEMO 通常 **2～5 分鐘**完成，含發言者辨識，輸出與本機模式相同的 `[SPEAKER_NN]` SRT
- 音訊會上傳至 Microsoft Azure；使用前需勾選知情同意。Azure 處理完不保留音訊，Call Coach 網站也不會收到
- 區域請選有 Fast Transcription 的：**`southeastasia`（新加坡）** 或 **`japaneast`（東京）**。`eastasia`（香港）沒有，會退回較慢的 SDK 模式且需額外安裝

本機 WhisperX 仍可用（音訊完全不上雲），在轉錄模式選「標準／快速」即可，Azure 模式下它會收合為「進階」。

### 團隊設定檔 `team-config.env`（管理者）

讓同事不用各自申請 Azure 或 Hugging Face：

1. 管理者在自己的助手填好 Azure 金鑰後，DEMO → **團隊設定** → **匯出目前設定（管理者）**，會下載 `team-config.env`
2. 以公司內部管道分享（**含金鑰，勿放公開位置**）
3. 同事：放在 Setup.exe 旁一起安裝，或安裝後在 **團隊設定** 貼上／選擇檔案 **匯入**
4. 助手每次啟動只會用它**填補 `.env` 空白或占位的欄位**，不會覆蓋同事自己填過的值

支援欄位：`CALL_COACH_TEAM_NAME`、`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`AZURE_SPEECH_ENDPOINT`（選填）、`HF_TOKEN`（選填）、`CALL_COACH_DEFAULT_MODE`（`azure` / `standard` / `fast`）。其他欄位一律忽略。路徑可用環境變數 `CALL_COACH_TEAM_CONFIG` 覆寫。

### 沒有錄影也能試

網頁「開發」與「DEMO」兩區都有 **載入範例逐字稿**（3 分鐘虛構 AI 課程電訪），不需助手、不需網路即可走完「標記 → 分析 → 報告」。

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
├── .env                   ← HF_TOKEN / Azure 金鑰（勿分享）
├── team-config.env        ← 團隊設定（管理者提供，選用）
├── .venv/                 ← WhisperX 環境（一鍵安裝後產生；Azure 模式不需要）
└── models/                ← AI 模型快取（約 3～6 GB）
```

## 兩種工作流程

| 模式 | 用途 | 操作 |
|------|------|------|
| **開發 · 電訪** | Vibe 錄音 < 20 分鐘 | 匯出 `.vibe.json` 上傳 Call Coach |
| **DEMO · 錄影** | 1～2 小時 MP4 | 本機轉錄後自動載入分析 |

電訪模式不需啟動本機助手；DEMO 模式需保持 `start_call_coach` 視窗開啟。

## HF_TOKEN

**只有本機 WhisperX 模式需要**；Azure 雲端模式不用。首次本機 DEMO 轉錄需 Hugging Face Read Token（用於辨識誰在說話）。在 Call Coach DEMO 模式按「前往取得 Token」，或至 https://huggingface.co/settings/tokens 建立。

需同意三個 pyannote 模型授權（community-1、diarization-3.1、segmentation-3.0）。

## 疑難排解

- **Smart App Control 已封鎖此應用程式的部分功能**（Windows 11）：SAC 只放行有數位簽章或信譽良好的程式；助手 exe、ffmpeg、WhisperX 未簽章會被擋。做法：① 改用「Azure 雲端轉錄」模式；② 請 IT 關閉 SAC（Windows 安全性 → 應用程式與瀏覽器控制 → Smart App Control 設定；**關閉後無法再開啟**）；③ 由公司提供程式碼簽章憑證，在 GitHub Secrets 設定 `CODESIGN_PFX_BASE64` / `CODESIGN_PFX_PASSWORD`，CI 會自動簽章 Setup.exe 與助手
- **安裝精靈完成但 DEMO 顯示缺轉錄環境**：從開始選單啟動 **Call Coach 本機助手**，按 **「安裝／修復轉錄環境」**。日誌：`C:\CallCoachAssistant\logs\install-setup.log`
- **CallCoachAssistant.exe / python312.dll 錯誤**：代表使用了**舊版**或點錯檔案。請改用安裝精靈 Setup.exe
- **完整環境安裝出現 Failed to fetch**：請確認 `CallCoachAssistant.cmd` 黑窗仍開啟，並下載 [最新版 Releases](https://github.com/Minoru1017/For-company-business-use/releases/latest)。若仍失敗，改按「僅安裝 WhisperX」
- **雙擊 start_call_coach 沒反應**：改用 `setup_portable.cmd` 或 `start_call_coach.cmd`（命令指令檔，不是 .pyw）
- **Call Coach 顯示未連線**：確認助手黑窗仍開啟；若使用 **Python 3.13/3.14**，請執行 **`setup_portable.cmd`** 安裝內建 Python 3.12
- **大檔 MP4 很慢**：建議手動複製到 `input\`，再按「重新掃描」
- **轉錄失敗**：查看 Call Coach 下方日誌；常見為 Token 未設定或 ffmpeg 未安裝（`winget install Gyan.FFmpeg`）
- **Azure：金鑰無效或無權限**：確認貼的是 Speech 資源的 **Key 1/2** 且區域與資源一致（Azure 入口網站 → 資源 → 金鑰與端點）
- **Azure：區域沒有 Fast Transcription**：把 Speech 資源建立在 `southeastasia` 或 `japaneast`；或在 `.env` 填 `AZURE_SPEECH_ENDPOINT` 指向自訂端點
- **Azure：音檔超過上限**：Fast Transcription 單檔上限 2 小時 / 250 MB；更長的錄影請先剪成兩段
- **一鍵安裝失敗**：在 Call Coach 按「複製日誌」或「下載日誌」，或開啟 `logs\` 資料夾將 `.log` 檔傳給技術支援
- **解除安裝**：在 DEMO 模式按「解除安裝轉錄環境」
