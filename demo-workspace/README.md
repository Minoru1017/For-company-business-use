# Call Coach 本機助手（demo-workspace）

在公司電腦上執行 DEMO 錄影轉逐字稿，並與 [Call Coach](https://minoru1017.github.io/For-company-business-use/) 整合。

## 快速開始

### 方式 A：Windows 安裝精靈（推薦，公司電腦）

1. 至 [Releases](https://github.com/Minoru1017/For-company-business-use/releases/latest) 下載 **`CallCoachAssistant-Setup.exe`**
2. 若主管有給你 **`team-config.env`**，放在 Setup.exe **旁邊**再執行（精靈會自動帶入、並取消勾選 WhisperX 下載）
3. 執行安裝精靈（建議使用預設位置 `C:\CallCoachAssistant`）；「轉錄引擎」頁可勾選是否安裝 **WhisperX**（約 1～3 GB）
4. 從開始選單啟動 **Call Coach 本機助手** → 網頁 **DEMO** 會顯示「首次啟動檢查」，缺什麼就按旁邊的按鈕補齊

不需 `.cmd`、不需 winget、不需自行安裝 Python。適合公司電腦封鎖腳本的情況。

**同一個 `CallCoachAssistant.exe` 內建兩種模式**（不需另外下載 `start_worker.cmd`）：

| 用途 | 怎麼開 |
|------|--------|
| 公司電腦 · 本機轉錄 API | 開始選單 → **Call Coach 本機助手**（或助手視窗已開著） |
| 家用 GPU · 遠端 Worker | 開始選單 → **Call Coach 遠端轉錄 Worker**；視窗內有 **網址、Token、「複製 Token」、安裝 GPU 版** |
| 不確定 | 在安裝資料夾雙擊 `CallCoachAssistant.exe` → 會跳出模式選擇 |
| 完整移除 | 助手或 Worker 視窗 → **完整解除安裝…**（清 `.venv`／`worker`／可選 `models`，並啟動 Windows 解除安裝精靈） |

### 公司連新竹桌面（標準：Tailscale + DeskIn）

**不必裝 Call Coach 自製喚醒 App。** 詳細圖文：[REMOTE_HSINCHU.md](REMOTE_HSINCHU.md)

| 電腦 | 建議安裝 |
|------|----------|
| **公司**（只要遠端睡眠 + DeskIn） | Releases 的 **`CallCoachCompanyRemote-Setup.exe`**（輕量，無 WhisperX） |
| **新竹 GPU 主機** | **`CallCoachAssistant-Setup.exe`** + `start_hsinchu_host_agent.cmd` |

1. 新竹、公司各裝 **Tailscale**（同一帳號）+ **DeskIn**（同一帳號，新竹設開機自啟）。  
2. **日常**：新竹只關螢幕、不睡眠 → 公司直接 **DeskIn** 連線。  
3. **要睡眠時**：新竹 PC 開 BIOS／網卡 **Wake-on-LAN**；公司需透過 **家裡常開設備**（NAS／小主機 + Tailscale）或日後路由器 WoL 設定喚醒，再開 DeskIn。路由器型號未知也可先用第 2 點。

進階（可忽略）：`CallCoachCompanyWake.exe` 為 repo 內選配工具。

### 零門檻路徑：Azure 雲端轉錄（團隊預設）

有 `team-config.env`（或自行填入 Azure 金鑰）時，DEMO 轉錄預設走 **Azure Speech Fast Transcription**：

- **不需** Hugging Face Token、**不需**下載 WhisperX / 模型、**不受** Smart App Control 影響（只用到 ffmpeg 抽音軌）
- 48 分鐘 DEMO 通常 **2～5 分鐘**完成，含發言者辨識，輸出與本機模式相同的 `[SPEAKER_NN]` SRT
- 音訊會上傳至 Microsoft Azure；使用前需勾選知情同意。Azure 處理完不保留音訊，Call Coach 網站也不會收到
- 區域請選有 Fast Transcription 的：**`southeastasia`（新加坡）** 或 **`japaneast`（東京）**。`eastasia`（香港）沒有，會退回較慢的 SDK 模式且需額外安裝

本機 WhisperX 仍可用（音訊完全不上雲），在轉錄模式選「標準／快速」即可，Azure 模式下它會收合為「進階」。

### 最快路徑：遠端主機轉錄（借用自己的 GPU 電腦）

公司電腦跑 CPU 太慢、又不想把音訊交給 Azure？把家裡（或任何地方）一台有 **NVIDIA 顯卡**的電腦變成 Worker，公司電腦只負責抽音軌、上傳、顯示進度、收回 SRT：

- 48 分鐘 DEMO 在 **RTX 5070** 上約 **3～8 分鐘**（WhisperX `large-v3` float16 + 分軌），比本機 `medium` 快 10 倍以上且更準
- 公司電腦**不需**安裝 WhisperX、**不需** HF Token；音訊只經過你的兩台電腦，遠端轉錄完即刪除
- Worker 同時只跑一件工作，多人使用會排隊；一個 Token 就是一把鑰匙，請只分享給信任的人

**家用主機（Worker）設定一次：**

1. 下載 `demo-workspace`（或安裝精靈），在 `.env` 填 `HF_TOKEN`（分軌模型授權，同本機模式）
2. 更新 NVIDIA 驅動到 **570 以上**（RTX 50 系列需 CUDA 12.8）
3. 雙擊 **`start_worker.cmd`** — 首次會安裝 **CUDA 12.8 版 PyTorch + WhisperX**（約 4 GB，10～20 分鐘），之後直接啟動 Worker
4. 視窗會列出 **網址**（`http://<IP>:8766`）與 **Token**（自動產生、存在 `.env`）。安裝精靈版可用 `CallCoachAssistant.exe --worker`
5. 若顯示「未偵測到 GPU」：執行 `start_worker.cmd reinstall` 重新安裝 GPU 版

**兩台電腦怎麼連（擇一）：**

- **Tailscale**（推薦）：兩台都裝 [Tailscale](https://tailscale.com/download) 登入同一帳號，公司電腦直接填 Worker 視窗顯示的 `http://100.x.x.x:8766`。點對點加密，不需開路由器埠、不需固定 IP
- **Cloudflare Tunnel**（公司電腦不能裝軟體時）：在家用主機安裝 `cloudflared`，執行 `cloudflared tunnel --url http://localhost:8766`（或設定具名 tunnel 綁自己的網域），公司電腦填它給的 `https://…` 網址（不加埠號）。Token 仍是唯一的門鎖，請勿再開其他公開埠
- **請勿**直接在路由器做 port forwarding 把 8766 暴露到網際網路

**公司電腦（已安裝助手）：** DEMO → 轉錄模式選 **遠端主機轉錄** → 貼上網址與 Token → **儲存並測試連線** → 勾選知情同意 → 開始。

**公司電腦（無法安裝／執行 .exe）：** 開 Call Coach **DEMO**，在「尚未連線本機轉錄助手」區使用 **瀏覽器直連新竹 GPU**：填 Worker 網址與 Token → 選擇 MP4 → 開始遠端轉錄。影片直傳你的 Worker（上限 2 GB），新竹主機用 ffmpeg 抽音軌後跑 WhisperX；完成後逐字稿自動載入網頁，報告在「把結果帶走」下載。**不需**本機助手。注意：GitHub Pages 為 https，若填 `http://100.x.x.x` 可能被瀏覽器當混合內容封鎖，請用 **Cloudflare Tunnel 的 https 網址** 或允許該站混合內容。

管理者也可把網址與 Token 匯出成 `team-config.env` 給同事（有助手時會自動帶入）。

進階設定（Worker 端 `.env` 或環境變數）：`CALL_COACH_WORKER_MODEL`（預設 GPU `large-v3`、CPU `medium`）、`CALL_COACH_WORKER_PORT`（預設 8766）、`CALL_COACH_WORKER_BIND`（預設 `0.0.0.0`）、`CALL_COACH_WORKER_NAME`（顯示名稱）。

### 團隊設定檔 `team-config.env`（管理者）

讓同事不用各自申請 Azure 或 Hugging Face：

1. 管理者在自己的助手填好 Azure 金鑰後，DEMO → **團隊設定** → **匯出目前設定（管理者）**，會下載 `team-config.env`
2. 以公司內部管道分享（**含金鑰，勿放公開位置**）
3. 同事：放在 Setup.exe 旁一起安裝，或安裝後在 **團隊設定** 貼上／選擇檔案 **匯入**
4. 助手每次啟動只會用它**填補 `.env` 空白或占位的欄位**，不會覆蓋同事自己填過的值

支援欄位：`CALL_COACH_TEAM_NAME`、`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`AZURE_SPEECH_ENDPOINT`（選填）、`HF_TOKEN`（選填）、`CALL_COACH_WORKER_URL` / `CALL_COACH_WORKER_TOKEN`（遠端主機，需成對）、`CALL_COACH_DEFAULT_MODE`（`remote` / `azure` / `standard` / `fast`）。其他欄位一律忽略。路徑可用環境變數 `CALL_COACH_TEAM_CONFIG` 覆寫。

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

- **Smart App Control 已封鎖此應用程式的部分功能**（Windows 11）：SAC 只放行有數位簽章或信譽良好的程式；助手 exe、ffmpeg、WhisperX 未簽章會被擋。做法：① 改用「Azure 雲端轉錄」模式；② 請 IT 關閉 SAC（Windows 安全性 → 應用程式與瀏覽器控制 → Smart App Control 設定；**關閉後無法再開啟**）；③ 由公司提供程式碼簽章憑證，在 GitHub Secrets 設定 `CODESIGN_PFX_BASE64` / `CODESIGN_PFX_PASSWORD`，CI 會自動簽章 Setup.exe、助手與解除安裝程式。**哪種憑證有效、ServBay／自簽憑證的限制、如何申請與佈署**，見 [CODESIGN.md](CODESIGN.md)
- **安裝精靈完成但 DEMO 顯示缺轉錄環境**：從開始選單啟動 **Call Coach 本機助手**，按 **「安裝／修復轉錄環境」**。日誌：`C:\CallCoachAssistant\logs\install-setup.log`
- **CallCoachAssistant.exe / python312.dll 錯誤**：代表使用了**舊版**或點錯檔案。請改用安裝精靈 Setup.exe
- **完整環境安裝出現 Failed to fetch**：請確認 `CallCoachAssistant.cmd` 黑窗仍開啟，並下載 [最新版 Releases](https://github.com/Minoru1017/For-company-business-use/releases/latest)。若仍失敗，改按「僅安裝 WhisperX」
- **雙擊 start_call_coach 沒反應**：改用 `setup_portable.cmd` 或 `start_call_coach.cmd`（命令指令檔，不是 .pyw）
- **Call Coach 顯示未連線**：確認助手黑窗仍開啟；若使用 **Python 3.13/3.14**，請執行 **`setup_portable.cmd`** 安裝內建 Python 3.12
- **大檔 MP4 很慢**：建議手動複製到 `input\`，再按「重新掃描」
- **轉錄失敗**：查看 Call Coach 下方日誌；常見為 Token 未設定或 ffmpeg 未安裝（`winget install Gyan.FFmpeg`）
- **長 DEMO 轉錄快結束時中斷、`output\.chunks\...\part_000` 是空的、沒有 .srt**：分段平行轉錄時某段 WhisperX 在對齊／辨識發言者階段被記憶體壓力擠掉。v11.3.3 起會依實體記憶體決定同時跑幾段（16 GB 標準模式為 2 段）、失敗的段會單獨重試一次，並在 `logs\transcribe-*.log` 記錄結束碼與原因。若仍失敗，可先改用「快速模式」或設定環境變數 `CALL_COACH_MAX_PARALLEL=1`
- **進階調校（環境變數）**：`CALL_COACH_MAX_PARALLEL`（同時轉錄段數上限，1～5）、`CALL_COACH_THREADS`（每段執行緒）、`CALL_COACH_BATCH`（batch size，1～16）、`CALL_COACH_RAM_GB`（覆寫記憶體偵測）
- **Azure：金鑰無效或無權限**：確認貼的是 Speech 資源的 **Key 1/2** 且區域與資源一致（Azure 入口網站 → 資源 → 金鑰與端點）
- **Azure：區域沒有 Fast Transcription**：把 Speech 資源建立在 `southeastasia` 或 `japaneast`；或在 `.env` 填 `AZURE_SPEECH_ENDPOINT` 指向自訂端點
- **Azure：音檔超過上限**：Fast Transcription 單檔上限 2 小時 / 250 MB；更長的錄影請先剪成兩段
- **遠端主機：無法連線**：確認家用主機的 Worker 黑窗／視窗還開著、兩端 Tailscale 都已登入（或 cloudflared 在跑）、網址含埠號 `8766`（Cloudflare 網址則不加）。在公司電腦瀏覽器直接開 Worker 網址，看到「Call Coach Worker」字樣代表網路通了
- **遠端主機：Worker Token 不正確**：在 Worker 視窗按「複製 Token」重新貼；Token 存在家用主機 `.env` 的 `CALL_COACH_WORKER_TOKEN`
- **遠端主機：未偵測到 GPU**：RTX 50 系列需 CUDA 12.8 版 torch — 執行 `start_worker.cmd reinstall`；並確認 NVIDIA 驅動 ≥ 570。Worker 會退回 CPU 執行，不會比公司電腦快
- **遠端主機：CUDA out of memory**：在 Worker 端 `.env` 改 `CALL_COACH_WORKER_MODEL=medium`（或 `large-v3-turbo`）後重啟 Worker
- **一鍵安裝失敗**：在 Call Coach 按「複製日誌」或「下載日誌」，或開啟 `logs\` 資料夾將 `.log` 檔傳給技術支援
- **解除安裝**：在 DEMO 模式按「解除安裝轉錄環境」
