# Sales Call Coach

顧問式銷售電訪逐字稿分析工具（VER 11）。

## 快速開始

```bash
npm install
npm run dev      # 開發：http://localhost:5173
npm run build    # 建置到 dist/
npm test         # 執行 Vitest 測試
```

建置完成後，用 Chrome / Edge 開啟 `dist/index.html`（或執行 `npm run preview`）。

## 分享給別人（最快方式）

合併到 `main` 後，GitHub Actions 會自動部署，分享這個網址即可：

**https://minoru1017.github.io/For-company-business-use/**

首次使用請到 GitHub repo → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。

之後每次推送到 `main`，網站會自動更新（約 1–2 分鐘）。

> 舊版單檔 `sales-call-coach.html` 仍保留作參考，請改用本專案結構。

## 功能

- 本機規則引擎：六步驟、五層資訊、適配判斷
- 說話者標記：Tab 切換、聚焦展開
- 選用 Gemini AI 深度分析（長逐字稿自動分段合併）
- 不輸入 API Key 時，本機規則分析完整可用

## 安全與隱私

- 逐字稿內容以 escape 處理，避免 DOM XSS
- API Key 可選擇不記住（僅 sessionStorage）
- AI 分析前需勾選同意傳送至 Google
- 請勿將 API Key 或客戶逐字稿提交至 Git

## 文件

- 技術交接：`docs/technical-handoff.pdf`
- **Vibe 匯出設定檢查清單**：`docs/vibe-export-checklist.md`（電訪 < 20 分鐘）
- **WhisperX 離線轉錄 SOP**：`docs/whisperx-setup.md`（DEMO 1～2 小時，不上雲）
- **DEMO 轉錄工作區**：`demo-workspace/`（虛擬環境 + 模型 + 錄影同一資料夾）
