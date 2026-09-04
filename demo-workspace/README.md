# DEMO 轉錄工作區

本資料夾**自包含**：虛擬環境、AI 模型快取、DEMO 錄影、輸出逐字稿都在同一處。  
刪除整個 `demo-workspace` 資料夾 = 完全移除，不影響系統其他位置。

> 音檔不上雲；僅**首次安裝**需網路下載 Python 套件與模型。

---

## 資料夾結構

```
demo-workspace/
├── setup.ps1          ← 一次性安裝（建立 .venv、下載依賴）
├── transcribe.ps1     ← 每次轉錄 DEMO
├── .env.example       ← 複製成 .env，填入 HF_TOKEN
├── .venv/             ← Python 虛擬環境（自動建立，勿提交 Git）
├── models/            ← AI 模型快取（自動建立，約 3～6 GB）
├── input/             ← 放入 demo.mp4
└── output/            ← 轉錄完成的 .srt
```

---

## 快速開始（Windows）

### 1. 前置：Python + ffmpeg

```powershell
# 確認 Python 3.10～3.12
python --version

# 若尚未安裝 ffmpeg
winget install Gyan.FFmpeg
```

### 2. 一次性安裝

在 `demo-workspace` 資料夾內，於 PowerShell 執行：

```powershell
cd 路徑\到\demo-workspace
.\setup.ps1
```

### 3. 設定 Hugging Face Token（分軌用，僅首次）

```powershell
copy .env.example .env
notepad .env
```

填入 `HF_TOKEN=hf_你的token`，並到以下頁面接受授權：  
https://huggingface.co/pyannote/speaker-diarization-community-1

### 4. 轉錄 DEMO

將錄影檔命名為 `demo.mp4` 放入 `input\`，然後：

```powershell
.\transcribe.ps1
```

或指定檔名：

```powershell
.\transcribe.ps1 -InputFile "客戶A-20260904.mp4"
```

完成後到 `output\` 取 `.srt`，上傳 [Sales Call Coach](https://minoru1017.github.io/For-company-business-use/)。

---

## 完全移除

關閉 PowerShell 後，直接刪除整個 `demo-workspace` 資料夾即可。  
不需額外解除安裝程式。

---

## 硬體參考（Intel 內顯筆電）

| 模型 | 2 小時 DEMO 預估 |
|------|----------------|
| `medium`（預設） | 約 1.5～2.5 小時 |
| `large-v3-turbo` | 約 2.5～4 小時 |

```powershell
.\transcribe.ps1 -Model large-v3-turbo
```

---

## 相關文件

- 完整 SOP：`docs/whisperx-setup.md`
- Vibe 電訪流程：`docs/vibe-export-checklist.md`
