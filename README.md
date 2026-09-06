# Sales Call Coach

顧問式銷售電訪逐字稿分析工具（VER 11）。

## 線上使用

**https://minoru1017.github.io/For-company-business-use/**

開啟後選擇工作流程：
- **開發 · 電訪**：上傳 Vibe 匯出的 `.vibe.json` 或 SRT
- **DEMO · 錄影**：本機轉錄 1～2 小時 MP4（需啟動 `demo-workspace`）

## 本機 DEMO 轉錄

1. 下載 `demo-workspace` 資料夾
2. 雙擊 `start_call_coach.pyw`
3. 在 Call Coach 選擇 **DEMO · 錄影轉逐字稿**

## 開發

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 建置到 dist/
npm test         # Vitest
```

## 功能

- 模式選擇：電訪分析 / DEMO 本機轉錄
- 本機規則引擎：六步驟、五層資訊、適配判斷
- DEMO 轉錄整合：WhisperX 本機轉錄 → 自動載入 SRT
- 選用 Gemini AI 深度分析

## 文件

- Vibe 匯出檢查清單：`docs/vibe-export-checklist.md`
- DEMO 工作區說明：`demo-workspace/README.md`

## 安全與隱私

- DEMO 音檔全程本機處理，不上傳
- 本機 API 需工作階段 Token，且僅允許 Call Coach 官方來源跨域存取
- HF Token 不寫入程序參數或日誌；`.env` 權限設為僅本機使用者可讀
- Gemini API Key 預設僅保留在本次瀏覽器分頁（需勾選才記住）
- AI 分析前需勾選同意傳送至 Google
