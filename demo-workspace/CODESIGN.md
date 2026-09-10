# 程式碼簽章（數位簽章）指南

本文說明 Call Coach 本機助手（`CallCoachAssistant-Setup.exe`、`CallCoachAssistant.exe`、`ffmpeg.exe`、解除安裝程式）如何簽章、哪種憑證能解決什麼問題，以及在 GitHub Actions / 本機建置時要設定什麼。

## 先講結論：三種憑證，三種效果

| 憑證來源 | 費用 | 「未知的發行者」UAC 提示 | SmartScreen 警告 | **Smart App Control（SAC）** | 適用情境 |
|---|---|---|---|---|---|
| **自簽／內部 CA**（ServBay 程式碼簽章憑證、`scripts\New-CodeSigningCert.ps1`、公司 AD CS） | 免費 | 只在**安裝了 .cer 的電腦**消失 | 仍會出現（信譽制） | **不行**：SAC 只認 Microsoft Trusted Root Program 內的 CA | 公司內部電腦，IT 可用 GPO/Intune 佈署 .cer；AppLocker／WDAC 發行者規則 |
| **公開 CA 的 OV 程式碼簽章憑證**（DigiCert、Sectigo、GlobalSign、SSL.com、Certum 等） | 約 US$200～500／年 + 硬體 token 或雲端 HSM | 消失（顯示公司名稱） | 新檔案初期仍可能警告，下載量累積後消失 | **可以**（RSA 憑證） | 對外發佈、SAC 開啟的 Windows 11 電腦 |
| **Azure Artifact Signing**（原 Trusted Signing） | 約 US$10／月 | 消失 | 同 OV | **可以**（Microsoft 自家服務） | **目前僅限美、加、歐盟、英國的組織／美加個人**，台灣公司無法申請 |

Microsoft 官方對 SAC 的規則（[Sign your app for Smart App Control compliance](https://learn.microsoft.com/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)）：

- 憑證必須由 **Microsoft Trusted Root Program 內的 CA** 簽發。自簽或內部 CA 即使加進「受信任的根憑證授權單位」也**不算**。
- 只接受 **RSA** 簽章，**不支援 ECC**。ServBay 預設建議 ECC，請選 RSA 2048／4096。
- 要簽**所有**執行檔：exe、dll、安裝程式、解除安裝程式、暫存檔。
- 加入企業管理（Intune／AD 網域）的裝置 **SAC 預設關閉**；SAC 只在全新安裝的消費者 Windows 11 上啟用，而且**關閉後就無法再開啟**。

> **重要限制**：就算我們的 Setup.exe／助手／ffmpeg 全部用公開 CA 簽章，WhisperX 是安裝時由 pip 下載到 `.venv` 的（torch、ctranslate2 等 DLL 多數**沒有簽章**）。在 SAC 開啟的電腦上，本機轉錄仍可能被擋；這種電腦請改用「Azure 雲端轉錄」模式，或由 IT 關閉 SAC。簽章能解決的是**安裝精靈與助手本體被擋、UAC 顯示未知發行者、以及日後 SmartScreen 的信譽累積**。

## ServBay 的程式碼簽章憑證能用嗎？

可以，但它屬於上表第一種（**內部 CA，不被 Windows 公開信任**），ServBay 文件自己也這麼寫。適合「公司內部電腦、IT 願意佈署根憑證」的情境。

在 ServBay 申請時請選：

- Usage Purpose：**Code Signing**
- Algorithm：**RSA**（不要 ECC，SAC 不接受）
- Key Length：**2048** 或 **4096**
- 記住密碼；匯出的 `.p12` 就是 PKCS#12，與 `.pfx` 相同格式，可直接用於下面所有步驟。

除了 `.p12`，還要從 ServBay 匯出 **ServBay User CA** 的憑證（`.cer`／`.crt`），IT 需要把它裝到公司電腦的「受信任的根憑證授權單位」，否則簽章會顯示「憑證鏈不受信任」。

不想裝 ServBay 的話，`scripts\New-CodeSigningCert.ps1` 用 Windows 內建功能做出等效的 RSA 自簽憑證（見下一節）。

## 路線 A：內部信任（免費，今天就能做）

### 1. 產生憑證

在任一台 Windows 電腦（不需系統管理員）：

```powershell
cd demo-workspace
.\scripts\New-CodeSigningCert.ps1 -Organization "貴公司名稱"
```

產出 `dist\codesign\`：

| 檔案 | 用途 | 機密？ |
|---|---|---|
| `CallCoach-CodeSign.pfx` | 私鑰 + 憑證，給 CI／建置機簽章 | **是**，不要提交到 git、不要寄 email |
| `CallCoach-CodeSign.cer` | 公開憑證，IT 佈署到公司電腦 | 否 |
| `CODESIGN_PFX_BASE64.txt` | 貼到 GitHub secret 的內容 | **是** |

或改用 ServBay 匯出的 `.p12`：`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.p12")) | Set-Clipboard`。

### 2. GitHub Actions 自動簽章

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**：

| Secret | 值 |
|---|---|
| `CODESIGN_PFX_BASE64` | `CODESIGN_PFX_BASE64.txt` 的內容（或 .p12 的 base64） |
| `CODESIGN_PFX_PASSWORD` | 憑證密碼 |
| `CODESIGN_TIMESTAMP_URL` | （選填）RFC 3161 時間戳伺服器；預設 DigiCert，失敗自動改 Sectigo |

之後每次 `main` 分支有 `demo-workspace/` 變更，`build-assistant.yml` 會簽章 `CallCoachAssistant.exe`、`ffmpeg.exe`、`ffprobe.exe`、`CallCoachAssistant-Setup.exe` 與內嵌的解除安裝程式，並在建置日誌印出憑證主體、金鑰演算法與每個檔案的 `Get-AuthenticodeSignature` 狀態。沒有設定 secrets 時維持未簽章建置。

### 3. 公司電腦信任這張憑證（IT，系統管理員）

```powershell
.\scripts\Trust-CallCoachPublisher.ps1 -CerPath .\CallCoach-CodeSign.cer
```

會把公開憑證裝進 `LocalMachine\Root` 與 `LocalMachine\TrustedPublisher`。大量佈署請用 GPO（電腦設定 → Windows 設定 → 安全性設定 → 公開金鑰原則）或 Intune 的「受信任的憑證」設定檔。移除：加 `-Remove`。

驗證：

```powershell
Get-AuthenticodeSignature .\CallCoachAssistant-Setup.exe   # Status 應為 Valid
signtool verify /pa /v .\CallCoachAssistant-Setup.exe
```

## 路線 B：公開信任（要讓 SAC 放行、對外發佈）

台灣公司目前無法使用 Azure Artifact Signing，需向公開 CA 購買 **OV（組織驗證）程式碼簽章憑證**：

1. **申請**：CA 會核對公司登記資料（經濟部商工登記、DUNS 或律師意見書）並電話回撥驗證。CA 一般需要數個工作日完成驗證。
2. **私鑰保管**：2023 年 6 月起，CA/Browser Forum 規定程式碼簽章私鑰必須放在 **FIPS 140-2 Level 2 的硬體 token 或雲端 HSM**，因此**拿不到可匯出的 .pfx**。兩種簽章方式：
   - **USB token 插在建置機上本機建置**：在該機執行 `certmgr.msc` 找到憑證的 SHA-1 指紋，然後

     ```powershell
     $env:CODESIGN_CERT_THUMBPRINT = "<指紋>"
     .\build_windows.ps1
     ```

     `scripts\Sign-File.ps1` 會改用 `signtool /sha1` 透過 token 簽章（過程中 token 驅動會要求 PIN）。
   - **雲端簽章在 GitHub Actions**：各 CA 有自家工具（SSL.com eSigner／CodeSignTool、DigiCert KeyLocker、Certum SimplySign、GlobalSign）。決定廠商後，在 `build-assistant.yml` 加入該廠商的 action 並將其提供的簽章命令設成 `CODESIGN_SIGNTOOL`／改寫 `Sign-File.ps1` 的 `signtool sign` 段落即可，其餘流程（簽哪些檔、解除安裝程式、驗證）不變。
3. **RSA**：申購時選 RSA 3072／4096，不要 ECC。
4. **SmartScreen**：OV 憑證沒有即時信譽，新版本剛發佈時仍可能出現「Windows 已保護您的電腦」，隨下載量增加而消失；EV 憑證過去有即時信譽，Microsoft 已於 2024 年起逐步取消此差異。

## 建置腳本支援的環境變數

| 變數 | 說明 |
|---|---|
| `CODESIGN_PFX_BASE64` | .pfx/.p12 的 base64（CI 用） |
| `CODESIGN_PFX_PATH` | 本機 .pfx/.p12 路徑（開發機用） |
| `CODESIGN_PFX_PASSWORD` | 以上兩者的密碼 |
| `CODESIGN_CERT_THUMBPRINT` | 憑證在 Windows 憑證存放區／USB token 的 SHA-1 指紋（OV/EV 憑證用） |
| `CODESIGN_TIMESTAMP_URL` | 自訂 RFC 3161 時間戳伺服器 |
| `CODESIGN_SIGNTOOL` | 自訂 `signtool.exe` 路徑（預設自動尋找 Windows SDK） |

建置時會檢查：憑證是否過期、是否 RSA（否則警告 SAC 不接受）、是否自簽（警告僅內部信任）、是否具備 Code Signing EKU（否則 Windows 拒絕）。時間戳一定會加，憑證到期後既有簽章仍有效。

## 常見問題

- **簽了還是被 Smart App Control 擋？** 若是自簽／ServBay 憑證，這是預期結果（見第一節）。若是公開 CA 憑證，確認：金鑰為 RSA、所有 exe 都有簽（含 `unins000.exe`）、被擋的是不是 `.venv` 內的 torch/ctranslate2 DLL（這部分無法由我們簽章）。
- **Setup.exe 顯示「未知的發行者」？** 該電腦沒有信任憑證鏈：自簽憑證請執行 `Trust-CallCoachPublisher.ps1`；ServBay 憑證請另外把 ServBay User CA 裝進受信任的根憑證。
- **CI 顯示 `signtool failed … timestamp`？** 時間戳伺服器暫時不通，腳本已會輪替 DigiCert／Sectigo 各重試 2 次；仍失敗可設 `CODESIGN_TIMESTAMP_URL` 換一家（如 `http://timestamp.globalsign.com/tsa/r6advanced1`）。
- **`.pfx` 密碼忘了？** 沒有找回機制，重新產生憑證並更新 secrets、重新佈署 .cer。
