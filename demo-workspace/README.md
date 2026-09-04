# DEMO 轉錄工作區

**一鍵自動化**：不用一行一行貼指令。

---

## 第一次使用（只做一次）

1. 雙擊 **`安裝.bat`**
2. 記事本開啟 **`.env`**，填入 `HF_TOKEN=hf_你的token`
3. 到 Hugging Face 同意三個 pyannote 模型（若尚未完成）

---

## 每次轉 DEMO（二選一）

| 方式 | 操作 |
|------|------|
| **一鍵轉錄** | MP4 放入 `input\` → 雙擊 **`一鍵轉錄.bat`** |
| **拖放轉錄** | 把 MP4 **拖到** **`拖放轉錄.bat`** 上 |

完成後到 **`output\`** 取 `.srt` → 上傳 [Call Coach](https://minoru1017.github.io/For-company-business-use/)

---

## 資料夾結構

```
demo-workspace/
├── 安裝.bat           ← 第一次：雙擊
├── 一鍵轉錄.bat       ← 每次：MP4 放 input 後雙擊
├── 拖放轉錄.bat       ← 每次：拖 MP4 到這個檔案
├── .env               ← HF_TOKEN
├── input/             ← 放錄影
├── output/            ← 轉好的 SRT
├── .venv/             ← 自動建立
└── models/            ← 模型快取
```

---

## 注意

- 轉錄中請**接電源**，2 小時 DEMO 約需 1.5～3 小時
- 刪除整個 `demo-workspace` 資料夾 = 完全移除
- 疑難排解：見 `疑難排解.md`

---

## 相關文件

- `docs/whisperx-setup.md`
- `docs/vibe-export-checklist.md`（電訪用 Vibe）
