---
name: call-coach-windows-installer
description: >-
  Call Coach Windows 安裝包（Setup.exe、Inno、PyInstaller、build_windows.ps1）、
  與 ZIP 可攜版差異、簽章與 CI。使用者問 exe 沒更新、安裝缺檔、Releases、
  build-assistant 時必讀。
---

# Call Coach：Windows 安裝包與發佈

## 建置觸發條件

Workflow：`.github/workflows/build-assistant.yml`

- **會建** `CallCoachAssistant-Setup.exe`：push `main` 且變更 `demo-workspace/**`、`package.json`、該 workflow
- **不會建 exe**：只改 `src/`（網頁）→ 只跑 `deploy-pages.yml`

版本號：`package.json` → `VERSION.txt`、Inno `AppVersion`、Release tag `assistant-v{version}-build.{run}`

## 安裝包內容來源

1. `build_windows.ps1` 組 `dist/installer-payload/`：
   - `runtime/python`、`runtime/ffmpeg`
   - `$AppFiles` 列出的 py、`.env.example`、**必含** `start_call_coach.cmd`、`start_worker.cmd`、`start_hsinchu_gpu.cmd`
   - `demo_app/`（僅跳轉到 GitHub Pages 的 stub）
   - PyInstaller 產物 `CallCoachAssistant.exe` + `_internal`
2. Inno：`installer/CallCoachAssistant.iss` 打包整個 payload

**ZIP 可攜版** 另複製 `啟動 Call Coach.cmd` 等；與 Setup 內容應同步檢查。

## 使用者體驗（安裝精靈）

- 預設目錄：`C:\CallCoachAssistant`（避免中文使用者路徑）
- 開始選單：`CallCoachAssistant.exe --assistant`（本機助手）、`--worker`（遠端 Worker）
- 可選任務：WhisperX 安裝（`installer/setup_env.py`）→ 預設 **CPU** `run_full_setup`；GPU 需事後 `setup-gpu` 或網頁 GPU 安裝
- `team-config.env` 放 Setup.exe 旁可一併帶入

## 改 installer 時的常見遺漏

| 遺漏 | 症狀 |
|---|---|
| 新 `.cmd` 未加入 `$AppFiles` | 安裝目錄沒有捷徑腳本，文件仍寫「雙擊 xxx.cmd」 |
| 新 Python 模組未加入 `call_coach_assistant.spec` hiddenimports | 打包 exe 執行時 ImportError |
| 只 bump 網頁未 bump demo-workspace | 使用者重下 exe 仍是舊 API |
| SAC 未簽章 | 安裝成功但 WhisperX/ffmpeg 被 Smart App Control 擋 → 引導 Azure 或 IT 關 SAC |

簽章與 SAC：見 `demo-workspace/CODESIGN.md`。

## Agent 工作流程

1. 功能若動到 **本機 API** → 改 `demo-workspace/`，commit 後提醒使用者等 **build-assistant** Release
2. 功能若只動 **網頁** → 改 `src/`，提醒 **Pages 部署** + 強刷
3. 新增啟動腳本或資料檔 → **同 PR 更新 `build_windows.ps1` `$AppFiles`**
4. 需要驗證：無法在 Linux CI 跑 GPU；以單元測試 + 文件 + 請使用者在 Windows 實機確認

## Releases 連結

- 安裝精靈：`.../releases/latest/download/CallCoachAssistant-Setup.exe`
- 網頁內連結應指向 `releases/latest`，不要寫死舊 build 號
