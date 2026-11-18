---
name: call-coach-quest-design
description: >-
  Call Coach 介面設計語彙（Quest 淺色／儀表深色）與主題切換規則。
  新增或改 UI、CSS、首頁／側欄版面、按鈕／卡片樣式，或使用者提到淺色、深色、Quest、儀表層、設計系統時必讀。
paths:
  - "src/styles/**/*.css"
  - "src/styles.css"
  - "index.html"
  - "src/ui-theme.js"
  - "src/chart.js"
---

# Call Coach：Quest／儀表設計語彙

## 何時使用

- 改任何畫面外觀、排版、色票、圓角、按鈕、卡片、側欄、首頁
- 加新區塊或元件，需要跟現有風格一致
- 處理淺色／深色主題、`data-theme`、外觀切換器
- 使用者說「照現在網站的風格」「Quest」「儀表層」

## 兩套主題（同一套產品）

| | 淺色 `light`（Quest） | 深色 `dark`（儀表層） |
|---|---|---|
| 觸發 | `html[data-theme="light"]` | `html[data-theme="dark"]` |
| 主檔 | `src/styles/quest.css` + `tone.css` + `blocks.css` | `src/styles/instrument.css`（規則都包在 dark 選擇器下） |
| 氛圍 | 暖米色底、白色大圓角卡片、柔影 | 近黑畫布、平面髮絲線、小圓角 |
| 強調 | 黑底黃字主按鈕、品牌黃做優先訊號 | 紙色（`--paper`）底＋深色字主按鈕 |
| 字體 | Plus Jakarta Sans + Noto Sans TC | Noto Sans TC + JetBrains Mono（數字） |

切換邏輯在 `src/ui-theme.js`：偏好 `light`｜`dark`｜`system` 存在 `call_coach_ui_theme`；`src/ui-theme-boot.js` 以一般 script 在 CSS 前載入防閃爍（不可改成 inline，會撞 CSP）。首頁頂欄三顆按鈕、側欄「外觀」輪替按鈕。

**預設**：`system`（跟 OS）。不要擅自改成永遠深色或永遠淺色。

## Agent 必做步驟

1. **先讀 token，再寫色值**  
   淺色看 `quest.css` / `tone.css` 的 `:root`；深色看 `instrument.css` 的 `html[data-theme="dark"]`。新顏色只能加 CSS 變數，禁止在元件裡新寫死 hex（投影片成品 `deck-themes` 除外）。
2. **版面結構優先沿用既有 class**  
   首頁：`home-top` / `home-grid` / `mode-card`；工作區：`app-sidebar` / `ws-head` / `section.sec`。不要另起一套 dashboard 網格。
3. **深色覆寫必須掛在 `html[data-theme="dark"]` 下**  
   不要再把儀表層規則寫回全域 `:root`，否則淺色會被蓋掉。淺色專用修正放 `ui-theme.css`。
4. **載入順序**（`src/styles.css`）最後幾層是：`instrument` → `day-stage` → `onboarding` → `mindmap` → **`ui-theme`**。新的主題相關覆寫加在 `ui-theme.css` 或對應主題檔，不要插到中間打亂 cascade。
5. **互動色用變數**  
   `--hover-wash`、`--hover-wash-2`、`--scrim`、`--elev-shadow` 已依主題定義；hover／選取／遮罩用這些，不要複製 `rgba(239,236,230,…)`（那是深色專用）。
6. **圖表**  
   `src/chart.js` 從 CSS 變數讀 `--sales` / `--cust` / `--muted`；改色票時同步確認圖表。
7. **改完驗證**  
   - 單元：`npx vitest run tests/ui-theme.test.js`  
   - 瀏覽器：首頁切「淺色／深色／系統」，確認首頁、側欄、症狀紀錄、簡報編輯視窗都跟著變，且無 FOUC／console error。

## 設計規則（兩套主題共通）

- **資訊層級**：`--ink`／標題與主動作 > `--text-2` 欄位標籤 > `--muted`／`--faint` 註解。正文不要上狀態色。
- **狀態色**：`--ok` 做到、`--warn` 部分、`--bad` 沒做到／客戶聲道；只用在小點、chip、左側細線。
- **品牌黃**（淺色 `--brand`）：優先訊號與主按鈕文字，不大面積當底。深色主按鈕改用紙色底。
- **一個區塊一件事**：一節一個標題；卡片不是預設容器——淺色用白卡分層，深色多用髮絲線分節。
- **避免**：紫漸層、玻璃光暈、多層陰影堆疊、圓角 pill 濫發（深色更應克制）、emoji 當圖示（用既有 SVG sprite）。

## 不要做的事

- 不要為了「好看」把深色規則改回全域，破壞淺色 Quest。
- 不要新增第二套切換 storage key；沿用 `call_coach_ui_theme` 與 `initUiThemeControls()`。
- 不要改 DEMO 簡報投影片主題（`deck-themes.css`／pptx 色票）來遷就介面主題——那是簡報成品。
- 不要在 Skill 未要求時重寫整個 CSS 架構；小改用變數與既有 class。

## 相關檔案

| 檔案 | 用途 |
|---|---|
| `src/ui-theme.js` | 偏好、解析、套用、切換器 |
| `src/ui-theme-boot.js` | 首屏同步套用（CSP 友善，非 inline） |
| `src/styles/quest.css` | 淺色版面與元件 |
| `src/styles/tone.css` | 淺色色調層級 |
| `src/styles/blocks.css` | 積木缺角（兩主題可共用結構） |
| `src/styles/instrument.css` | 深色儀表層（已限定 dark） |
| `src/styles/ui-theme.css` | 切換器樣式＋淺色洗色修正 |
| `tests/ui-theme.test.js` | 主題邏輯測試 |
