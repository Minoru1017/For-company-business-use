# Vibe 匯出設定檢查清單

供業務／主管在將電訪逐字稿匯入 **Sales Call Coach** 前使用。  
目標：讓「業務／客戶」標籤盡量在匯入時就正確，減少事後逐句修正。

---

## 一、錄音當下（影響最大）

- [ ] **盡量雙軌錄音**（業務麥、客戶端分開），Vibe 分軌品質通常最好
- [ ] 單軌時確認兩人聲音可分辨，避免同時搶話、背景音過大
- [ ] 通話開始前 3–5 秒保留靜音或問候，方便工具對齊時間軸
- [ ] 錄音檔與之後匯出的逐字稿必須是**同一次通話**（勿混剪）

---

## 二、Vibe 專案設定

- [ ] 已建立對應通話專案，音檔完整上傳且轉錄完成
- [ ] 在 Vibe 設定檔開啟說話者辨識（建議）  
  路徑（Windows）：`%APPDATA%\github.com.thewh1teagle.vibe\app_config.json`  
  設定項：`"transcription.recognizeSpeakers": true`
- [ ] 轉錄語言設為**繁體中文**（`transcription.modelOptions.lang` 等）
- [ ] 若有手動指定說話者，確認：
  - **Speaker 0（或第一軌）＝ 業務**
  - **Speaker 1（或第二軌）＝ 客戶**
- [ ] 檢查 Vibe 預覽：問候、自我介紹是否在業務軌；客戶回答是否在客戶軌

> **Call Coach 對應規則**  
> `speaker: 0` 或 `Speaker 0:` → **業務**；`speaker: 1` 或 `Speaker 1:` → **客戶**。

### Vibe 逐字稿存放位置（Windows 範例）

```
C:\Users\<使用者>\Documents\Vibe\
├── 通話名稱-20260901-153000\
│   ├── transcript.vibe.json   ← 專案資料夾（新格式，推薦）
│   └── audio.mp3
└── 通話名稱-20260901-120000.vibe.json   ← 舊格式扁平檔
```

**最省事做法**：直接上傳 `transcript.vibe.json` 到 Call Coach，不必再匯出 SRT。

> **DEMO（1～2 小時）**：若 Vibe 轉錄太慢，可改用本機 **WhisperX** 產 SRT，詳見 `docs/whisperx-setup.md`。

---

## 三、匯出／匯入格式（優先順序）

| 優先 | 格式 | 說明 |
|------|------|------|
| ★★★ | **transcript.vibe.json** | Vibe 原生格式，含 `segments[].speaker`（毫秒時間戳），**說話者最準** |
| ★★☆ | **SRT** | 含時間戳＋Speaker 標籤，通用性高 |
| ★★☆ | **VTT** | 同上，請確認時間格式為 `hh:mm:ss.mmm` |
| ★☆☆ | **TXT（含時間戳）** | 可用，但時間精度較粗，Speaker 標籤需手動確認 |

- [ ] **優先直接上傳** `transcript.vibe.json`（開啟 `recognizeSpeakers` 後）
- [ ] 若需給沒有 Vibe 的人，再匯出 **SRT** 或 **VTT**
- [ ] 編碼選 **UTF-8**（避免中文亂碼）
- [ ] 匯出時勾選**保留說話者／Speaker 標籤**（若匯出 SRT/VTT）

### Vibe API（進階，通常不必用）

Vibe 本機轉錄 API（Sona）預設**關閉**，且每次啟動 port 會變。  
**Call Coach 不需要呼叫 API**——讀取已存好的 `transcript.vibe.json` 即可。

僅在「要當場轉錄新音檔」時才需要 API：

1. Vibe → Settings → **API & Agents** 開啟
2. `GET <baseUrl>/health` 確認服務正常
3. 轉錄完成後，到 `Documents\Vibe\` 取 `transcript.vibe.json` 上傳 Call Coach

無 API 時也可用 Vibe 內建 `sona.exe transcribe` 離線轉錄，結果同樣存成 `.vibe.json`。

### Call Coach 可辨識的 Speaker 格式

每句開頭需類似以下其一（中英文皆可）：

```
Speaker 0: 您好，請問方便聊幾分鐘嗎？
Speaker 1: 可以。
說話者 0：我是 XX 學院的顧問。
說話者 1：嗯，你好。
```

不支援的範例（需事後手動標記）：

```
業務：您好……        ← 無 Speaker 編號
[業務] 您好……       ← 非 0/1 格式
```

---

## 四、匯出後快速自檢（約 1 分鐘）

用記事本或 VS Code 打開檔案，確認：

- [ ] 檔案開頭無亂碼，中文正常
- [ ] 有時間戳（例如 `00:00:05,000 --> 00:00:12,000` 或 `[00:05]`）
- [ ] 多數句子帶 `Speaker 0` / `Speaker 1`（或說話者 0 / 1）
- [ ] **Speaker 0 的內容像業務**（問候、自我介紹、提問、講方案）
- [ ] **Speaker 1 的內容像客戶**（回答、描述狀況、表達疑慮）
- [ ] 若兩者對調 → 在 Call Coach 用「**全部互換**」，或於 Vibe 重新指定 Speaker 後再匯出

### 常見異常

| 現象 | 可能原因 | 處理方式 |
|------|----------|----------|
| 全部沒有 Speaker 標籤 | Vibe 未開分軌或未勾選匯出 | 回 Vibe 重匯；或進 Call Coach 用 Tab 逐句標記 |
| 0/1 整段對調 | Vibe 軌道指定相反 | Call Coach「全部互換」 |
| 只有一個 Speaker | 單軌且分離失敗 | 勿用「自動猜測」；用 Tab 人工標記 |
| 時間軸錯亂 | 剪輯過或匯出錯檔 | 重新匯出原始完整通話 |

---

## 五、匯入 Call Coach 後

- [ ] 上傳成功後查看「**已載入（N 句）**」句數是否合理
- [ ] 快速掃 3–5 句：業務／客戶標籤是否大致正確
- [ ] **不要用「自動猜測」取代已正確的 Speaker 0/1**（會覆蓋較準的標籤）
- [ ] 點選句子 → **Tab** 切換錯誤標籤 → **↑↓** 移動 → 點空白收起
- [ ] 標記完成後再按「**開始分析**」

---

## 六、建議 SOP（給團隊）

```
錄音（雙軌優先）
  → Vibe 轉錄（recognizeSpeakers: true）
  → 確認 speaker 0＝業務、1＝客戶
  → 直接上傳 transcript.vibe.json 到 Call Coach
  → Tab 快速修正 → 開始分析
```

---

## 七、隱私提醒

- [ ] 上傳前刪除或改名客戶姓名、電話、公司全名等個資（若需外部分享）
- [ ] 使用 Gemini AI 分析前，務必先**去識別化**並勾選同意
- [ ] 勿將含客戶資料的逐字稿提交至 Git 或公開連結

---

## 相關文件

- 技術交接：`docs/technical-handoff.pdf`
- 工具網址：https://minoru1017.github.io/For-company-business-use/
