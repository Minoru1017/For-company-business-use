# DEMO 轉錄工作區

把 DEMO 錄影（MP4）在本機轉成逐字稿（SRT），再上傳 [Call Coach](https://minoru1017.github.io/For-company-business-use/) 分析。**音檔全程不上傳雲端。**

---

## 推薦：與 Call Coach 整合（一頁完成）

1. 雙擊 **`start_demo_app.pyw`**（或 `start_demo_app.cmd` / `啟動轉錄助手.pyw`）
2. 瀏覽器自動開啟 **Call Coach**，展開「還沒有 DEMO 逐字稿？」
3. 畫面顯示 **「本機轉錄助手已連線」** → 一鍵安裝 → 貼 Token → 拖曳 MP4 → 開始轉錄
4. 轉錄完成後 **自動載入逐字稿** 到 Call Coach 分析（不需手動上傳 SRT）

> 找不到檔案？請開啟 **`START_HERE.txt`**。若 `.pyw` 無法雙擊，改用 **`start_demo_app.cmd`** 或在 CMD 執行 `python demo_app.py`。

獨立介面（不開 Call Coach）：執行 `python demo_app.py` 後開啟 http://127.0.0.1:8765/

---

## 進階：命令列（封鎖 .bat 時）

```cmd
cd /d C:\Users\經銷業務\demo-workspace
python setup_demo.py
python transcribe_demo.py
```

---

## 若 .bat 可用：一鍵雙擊

| 檔案 | 用途 |
|------|------|
| `安裝.bat` | 第一次安裝 |
| `一鍵轉錄.bat` | MP4 放 `input\` 後雙擊 |
| `拖放轉錄.bat` | 拖 MP4 到檔案上 |

---

## 資料夾結構

```
demo-workspace/
├── START_HERE.txt      ← 找不到啟動檔？先看這個
├── start_demo_app.pyw  ← 推薦：雙擊啟動（英文檔名）
├── start_demo_app.cmd  ← .pyw 無法用時改雙擊這個
├── 啟動轉錄助手.pyw    ← 同上（中文檔名）
├── demo_app.py         ← 轉錄助手主程式
├── setup_demo.py       ← 命令列安裝
├── transcribe_demo.py  ← 命令列轉錄
├── .env                ← HF_TOKEN
├── input/              ← 放 MP4
├── output/             ← 取 SRT
├── .venv/
└── models/
```

---

## 相關文件

- **CMD 操作手冊**：`DEMO轉錄-CMD操作手冊.html`
- `疑難排解.md`
- `docs/whisperx-setup.md`
