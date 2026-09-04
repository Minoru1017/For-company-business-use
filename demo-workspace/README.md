# DEMO 轉錄工作區

本資料夾**自包含**：虛擬環境、AI 模型快取、DEMO 錄影、輸出逐字稿都在同一處。  
刪除整個 `demo-workspace` 資料夾 = 完全移除，不影響系統其他位置。

> 音檔不上雲；僅**首次安裝**需網路下載 Python 套件與模型。

---

## 資料夾結構

```
demo-workspace/
├── setup.cmd          ← 雙擊安裝（推薦，不需 PowerShell）
├── transcribe.cmd     ← 雙擊轉錄
├── 疑難排解.md         ← 不能執行時看這裡
├── .env.example       ← 複製成 .env，填入 HF_TOKEN
├── .venv/             ← Python 虛擬環境（自動建立）
├── models/            ← AI 模型快取（約 3～6 GB）
├── input/             ← 放入 demo.mp4
└── output/            ← 轉錄完成的 .srt
```

---

## 快速開始（Windows）

> **請雙擊 `setup.cmd`，不要用 `setup.ps1`。**

### 1. 安裝 Python（若尚未安裝）

下載：https://www.python.org/downloads/ （建議 3.11）

安裝時**務必勾選** `Add python.exe to PATH`，裝完**重開電腦**。

### 2. 一次性安裝

**雙擊 `setup.cmd`**

或在命令提示字元：

```cmd
cd C:\Users\經銷業務\demo-workspace
setup.cmd
```

### 3. 設定 HF_TOKEN

用記事本開啟 `.env`：

```
HF_TOKEN=hf_你的token
```

並接受授權：https://huggingface.co/pyannote/speaker-diarization-community-1

### 4. 轉錄

將 `demo.mp4` 放入 `input\`，**雙擊 `transcribe.cmd`**。

完成後到 `output\` 取 `.srt` → 上傳 [Sales Call Coach](https://minoru1017.github.io/For-company-business-use/)

---

## 不能執行？

見 **`疑難排解.md`**（含完全手動安裝步驟）

---

## 完全移除

刪除整個 `demo-workspace` 資料夾即可。

---

## 相關文件

- 完整 SOP：`docs/whisperx-setup.md`
- Vibe 電訪：`docs/vibe-export-checklist.md`
