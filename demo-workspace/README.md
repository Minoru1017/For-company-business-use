# DEMO 轉錄工作區

**公司電腦封鎖 .bat 時，請用 Python 腳本（下方「封鎖 .bat」一節）。**

---

## 封鎖 .bat / 無法雙擊安裝時（推薦）

在 `demo-workspace` 資料夾開啟**命令提示字元**（網址列輸入 `cmd`），只需兩條指令：

```cmd
cd /d C:\Users\經銷業務\demo-workspace

python setup_demo.py
```

`.env` 填好 `HF_TOKEN` 後，每次轉 DEMO：

```cmd
python transcribe_demo.py
```

MP4 放在 `input\` 即可（自動找最新的 `.mp4`）。

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
├── setup_demo.py       ← 封鎖 bat 時：python setup_demo.py
├── transcribe_demo.py  ← 封鎖 bat 時：python transcribe_demo.py
├── .env                ← HF_TOKEN
├── input/              ← 放 MP4
├── output/             ← 取 SRT
├── .venv/
└── models/
```

完成後上傳 `output\*.srt` → [Call Coach](https://minoru1017.github.io/For-company-business-use/)

---

## 相關文件

- **CMD 操作手冊（PDF）**：`DEMO轉錄-CMD操作手冊.pdf`（亦可開啟 `.html` 用瀏覽器列印）
- `疑難排解.md`
- `docs/whisperx-setup.md`
