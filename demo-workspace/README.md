# DEMO 轉錄工作區

把 DEMO 錄影（MP4）在本機轉成逐字稿（SRT），再上傳 [Call Coach](https://minoru1017.github.io/For-company-business-use/) 分析。**音檔全程不上傳雲端。**

---

## 推薦：圖形化轉錄助手（不需 CMD）

適合非資訊背景同事，四步驟完成：

1. 雙擊 **`啟動轉錄助手.pyw`**（或執行 `python demo_app.py`）
2. 瀏覽器會開啟本機操作介面 → 按「**一鍵安裝**」
3. 貼上 **HF_TOKEN** → 拖曳 MP4 錄影 → 按「**開始轉錄**」
4. 完成後按「**開啟 output 資料夾**」→ 上傳 `.srt` 到 Call Coach

> 若雙擊 `.pyw` 沒反應：在資料夾網址列輸入 `cmd`，執行 `python demo_app.py`

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
├── 啟動轉錄助手.pyw    ← 推薦：雙擊開啟圖形介面
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
