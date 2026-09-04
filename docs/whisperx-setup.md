# WhisperX 離線轉錄 SOP（DEMO 專用）

供業務／主管將 **1～2 小時 DEMO 錄影（MP4）** 在本機轉成逐字稿，再匯入 **Sales Call Coach** 分析。  
**音檔與逐字稿全程不離開公司電腦**，符合 DEMO 不能上雲的要求。

---

## 一、適用情境

| 項目 | 說明 |
|------|------|
| 音檔來源 | DEMO 錄影 MP4（通常 < 500MB、1～2 小時） |
| 說話者 | 顧問（業務）+ 客戶，共 2 人 |
| 語言 | 繁體中文（可夾雜英文術語） |
| 輸出 | SRT（含 `[SPEAKER_00]` / `[SPEAKER_01]` 標籤） |
| 下游 | 上傳 SRT 至 Call Coach → Tab 微調 → 開始分析 |

---

## 二、環境需求

### 硬體（建議）

| 等級 | 規格 | 2 小時 DEMO 預估時間 |
|------|------|---------------------|
| 佳 | NVIDIA GPU 8GB+（RTX 3060 以上） | 約 15～40 分鐘 |
| 可 | Apple Silicon Mac（M1/M2/M3） | 約 30～90 分鐘 |
| 慢 | 僅 CPU（無獨顯） | 約 1～3 小時 |

### 軟體

- **Python 3.10～3.12**（建議 3.11）
- **ffmpeg**（處理 MP4 / 抽音軌）
- **CUDA**（有 NVIDIA GPU 時，可大幅加速）

---

## 三、一次性安裝（需網路，僅下載模型）

> 此步驟需要網路下載 Python 套件與 AI 模型，**不會上傳你的音檔**。  
> 完成後即可完全離線使用。

### 步驟 1：安裝 ffmpeg

**Windows（winget）：**

```powershell
winget install Gyan.FFmpeg
```

**macOS：**

```bash
brew install ffmpeg
```

### 步驟 2：建立 Python 虛擬環境

```bash
python -m venv ~/.whisperx-env

# Windows PowerShell
~\.whisperx-env\Scripts\Activate.ps1

# macOS / Linux
source ~/.whisperx-env/bin/activate
```

### 步驟 3：安裝 WhisperX

```bash
pip install -U pip
pip install whisperx
```

有 NVIDIA GPU 時，另裝 CUDA 版 PyTorch（依 [pytorch.org](https://pytorch.org) 選對應指令）。

### 步驟 4：取得 Hugging Face Token（分軌用，僅首次）

1. 註冊 [Hugging Face](https://huggingface.co/join)
2. 建立 Read Token：[Settings → Access Tokens](https://huggingface.co/settings/tokens)
3. 接受以下模型授權條款（各點進頁面按 Agree）：
   - [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1)

### 步驟 5：設定環境變數

**Windows PowerShell（建議寫入使用者設定檔）：**

```powershell
$env:HF_TOKEN = "hf_你的token"
```

**macOS / Linux：**

```bash
export HF_TOKEN="hf_你的token"
# 可寫入 ~/.bashrc 或 ~/.zshrc
```

### 步驟 6：驗證安裝

用一段 1～2 分鐘測試音檔跑通即可：

```bash
whisperx test.wav --model small --language zh --diarize --hf_token $env:HF_TOKEN --min_speakers 2 --max_speakers 2 --output_format srt --output_dir ./test-out
```

成功後 `./test-out/` 會出現 `.srt` 檔。

---

## 四、DEMO 轉錄 SOP（每次使用）

### 1. 錄音當下

- [ ] 顧問與客戶聲音盡量清楚、減少同時搶話
- [ ] 開場 3～5 秒保留問候（方便確認誰是 SPEAKER_00）
- [ ] 錄影檔存放於公司受控資料夾（勿放個人雲端）

### 2. 執行轉錄

將 `demo.mp4` 放到本機，在該資料夾開啟終端機：

**有 NVIDIA GPU：**

```bash
whisperx demo.mp4 \
  --model large-v3-turbo \
  --language zh \
  --device cuda \
  --compute_type int8 \
  --batch_size 4 \
  --diarize \
  --hf_token $HF_TOKEN \
  --min_speakers 2 \
  --max_speakers 2 \
  --output_format srt \
  --output_dir ./output
```

**僅 CPU：**

```bash
whisperx demo.mp4 \
  --model large-v3-turbo \
  --language zh \
  --device cpu \
  --compute_type int8 \
  --diarize \
  --hf_token $HF_TOKEN \
  --min_speakers 2 \
  --max_speakers 2 \
  --output_format srt \
  --output_dir ./output
```

**Windows PowerShell 單行版：**

```powershell
whisperx demo.mp4 --model large-v3-turbo --language zh --device cuda --compute_type int8 --batch_size 4 --diarize --hf_token $env:HF_TOKEN --min_speakers 2 --max_speakers 2 --output_format srt --output_dir .\output
```

> **不要加** `--highlight_words True`（會產生逐字高亮 SRT，句數過碎，不適合 Call Coach）。

### 3. 匯出檔位置

```
output/
└── demo.srt    ← 上傳這個檔
```

### 4. 快速自檢（約 1 分鐘）

用記事本或 VS Code 打開 SRT，確認：

- [ ] 中文無亂碼（UTF-8）
- [ ] 每段含 `[SPEAKER_00]` 或 `[SPEAKER_01]`
- [ ] **SPEAKER_00 的內容像顧問**（問候、自我介紹、提問、講方案）
- [ ] **SPEAKER_01 的內容像客戶**（回答、描述狀況、表達疑慮）
- [ ] 若兩者對調 → 進 Call Coach 用「**全部互換**」

**SRT 範例（Call Coach 可辨識）：**

```
1
00:00:05,000 --> 00:00:12,000
[SPEAKER_00] 您好，我是 XX 學院的課程顧問。

2
00:00:12,500 --> 00:00:18,000
[SPEAKER_01] 你好，請說。
```

### 5. 匯入 Call Coach

1. 開啟 [Sales Call Coach](https://minoru1017.github.io/For-company-business-use/)
2. 上傳 `demo.srt`
3. 確認「已載入（N 句）」句數合理
4. 快速掃 3～5 句：業務／客戶標籤是否正確
5. Tab 修正錯誤標籤 → **開始分析**

---

## 五、Call Coach 對應規則

| WhisperX 標籤 | Call Coach 角色 |
|---------------|----------------|
| `SPEAKER_00`（編號最小） | **業務（S）** |
| `SPEAKER_01` | **客戶（C）** |

若顧問不是 00，在 Call Coach 點「全部互換」即可。

---

## 六、常見問題

| 現象 | 可能原因 | 處理方式 |
|------|----------|----------|
| 沒有 SPEAKER 標籤 | 未加 `--diarize` 或 HF token 無效 | 確認 token、已接受 pyannote 授權 |
| GPU 記憶體不足 | 模型太大 | 加 `--compute_type int8 --batch_size 4`，或改 `--model medium` |
| 中文辨識差 | 語言未指定 | 務必加 `--language zh` |
| 兩人常被標成同一人 | 單軌、聲音太像 | 確認 `--min_speakers 2 --max_speakers 2`；必要時 Tab 手動標記 |
| 轉錄很慢 | 僅 CPU + 大模型 | 有 GPU 用 `--device cuda`；或改用 `medium` 模型 |
| 重複幻覺句 | 長段靜音或雜音 | 錄音時減少背景音；可加 `--vad_method silero` |

---

## 七、完全離線模式（模型已下載後）

首次成功轉錄後，模型會快取在本機。之後可強制離線：

```bash
export HF_HUB_OFFLINE=1    # macOS / Linux
$env:HF_HUB_OFFLINE = "1"  # Windows PowerShell
```

---

## 八、與 Vibe 的取捨

| | Vibe | WhisperX |
|--|------|----------|
| 介面 | 圖形化，易上手 | 命令列 |
| 長檔速度 | 較慢（本機 CPU 常見） | GPU 下明顯較快 |
| 輸出格式 | `transcript.vibe.json`（最順） | SRT（Call Coach 已支援） |
| 分軌 | 佳（雙軌錄音時） | 佳（pyannote） |
| 隱私 | 完全本機 | 完全本機 |

**建議**：電訪（< 20 分鐘）繼續用 Vibe；**DEMO（1～2 小時）改用 WhisperX**。

---

## 九、隱私提醒

- [ ] DEMO 原始檔與 SRT 存放於公司受控位置
- [ ] 勿將含客戶資料的逐字稿提交至 Git 或公開連結
- [ ] 使用 Gemini AI 分析前，務必先**去識別化**並勾選同意

---

## 相關文件

- Vibe 電訪 SOP：`docs/vibe-export-checklist.md`
- Call Coach 工具：https://minoru1017.github.io/For-company-business-use/
