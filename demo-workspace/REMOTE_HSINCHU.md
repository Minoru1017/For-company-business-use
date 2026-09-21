# 公司連新竹電腦（Tailscale + DeskIn）

**不用** Call Coach 自製喚醒程式。照下面做即可。

---

## 你要裝的（兩邊各一次）

1. **[Tailscale](https://tailscale.com/download)** — 新竹、公司各登入**同一個帳號**。  
2. **DeskIn** — 兩邊登入同一帳號，新竹那台設**開機自動啟動**。

路由器型號**現在不知道也沒關係**，先看「每天怎麼用」；要遠端**叫醒**睡眠中的新竹 PC，再看後面「喚醒」一節。

---

## 每天怎麼用（最簡單）

新竹電腦**開著或只關螢幕**（不要睡眠）：

1. 公司電腦打開 **DeskIn**  
2. 點新竹那台 → 遠端桌面  
3. 要在新竹跑 Call Coach 轉錄，在遠端桌面裡開「本機助手」即可  

這樣**完全不用**設定 WoL、不用路由器型號。

---

## 新竹要省電、會按「睡眠」時

睡眠後公司 **DeskIn 連不上**，要先**喚醒**。請在新竹 PC 做一次：

### ① 開 Wake-on-LAN（新竹 PC）

- 重開進 **BIOS** → 找 **Wake on LAN** → 開啟  
- Windows：**裝置管理員** → **有線網路卡** → 內容 → **電源管理** → 勾「允許喚醒」  
- 同一張網卡 → **進階** → **Wake on Magic Packet** → Enabled  
- 用 **網路線** 接路由器（比 Wi‑Fi 穩）

查 MAC（記下來）：CMD 輸入 `getmac`

### ② 怎麼從公司「叫醒」（路由器型號還不知道時）

**建議：家裡放一台「常開」的設備幫你發喚醒封包**

| 常開設備 | 你要做的 |
|----------|----------|
| NAS（群暉等） | 查 NAS 是否內建 WoL / 或用 Tailscale SSH 進 NAS 發 wakeonlan |
| 舊筆電 / 小主機 | 裝 Tailscale，裝 `wakeonlan` 或 **UpSnap**（見 [Tailscale 官方說明](https://tailscale.com/blog/wake-on-lan-tailscale-upsnap)） |
| 只有新竹這一台 | 睡眠前**不要關機**；或改「只關顯示器」；或之後查路由器是否支援 WoL |

**從公司操作（有中繼時）：**

1. 公司 PC 開 Tailscale（已登入）  
2. SSH 或開中繼上的 WoL 網頁 → 對新竹 MAC 按喚醒  
3. 等 1～2 分鐘 → 開 **DeskIn** 連新竹  

**以後知道路由器品牌時：** 登入路由器後台（新竹 PC 打 `ipconfig` 看 **預設閘道**，常是 `192.168.1.1`），找 **Wake on LAN** 選單，依說明書填 MAC。

### ③ 看 Tailscale 有沒有內建「Wake」

公司 PC 打開 Tailscale App → 點新竹裝置 → 若有 **Wake / Send WoL** 可直接試。沒有這按鈕就用上面「常開中繼」。

---

## 公司端讓新竹「睡眠」（選用）

**前提**：新竹 PC **目前是醒的**，且正在跑 **主機代理**（不是 Tailscale 本身）。

1. **新竹**（做一次）：雙擊 `start_hsinchu_host_agent.cmd` 或 **`install_host_agent.cmd`**（舊版安裝若缺 cmd 用後者）  
   - 或 CMD：`cd /d C:\CallCoachAssistant` → `CallCoachAssistant.exe --host-agent`  
   - 仍沒有：至 [GitHub 此檔](https://github.com/Minoru1017/For-company-business-use/raw/main/demo-workspace/start_hsinchu_host_agent.cmd) 另存到助手資料夾  
   - 記下 **Host Token**（圖形視窗上方欄位 → **複製 Token**；若只有黑窗：開 `C:\CallCoachAssistant\.env` 找 `CALL_COACH_HOST_AGENT_TOKEN=`）  
   - 或直接執行 **`CallCoachAssistant.exe --host-agent`** 開圖形視窗  
   - 建議寫入新竹 `.env`：`CALL_COACH_HOST_AGENT_TOKEN=...`  
   - 此黑窗/背景要在你想被遠端休眠前保持運行（可設開機自動執行）。  
2. **新竹防火牆**：若公司連不上，允許 **TCP 8769** 私人/Tailscale 網路。  
3. **公司**：  
   - **推薦**：從 [GitHub Releases](https://github.com/Minoru1017/For-company-business-use/releases) 下載 **`CallCoachCompanyRemote-Setup.exe`**（公司專用輕量包，不含轉錄）  
   - 或已裝完整助手時：雙擊 `start_company_remote_sleep.cmd`  
   - 第一次會問 **Tailscale IP**（例 `100.126.54.41`）和 **Token**，之後存在  
     `%APPDATA%\CallCoachRemoteHsinchu\config.json`。  

睡眠後 **DeskIn 會斷**；要再用需 **WoL 喚醒** 或到新竹按電源。若不想處理喚醒，請改「只關螢幕」不要遠端睡眠。

---

## 和 Call Coach 的關係

| 需求 | 用什麼 |
|------|--------|
| 遠端看新竹桌面、操作軟體 | **DeskIn** |
| 公司安全連到新竹 | **Tailscale**（可選，但強烈建議） |
| DEMO 轉錄、GPU Worker | **Call Coach 本機助手**（與 DeskIn 分開） |

repo 裡的 `CallCoachCompanyWake.exe` 是**進階選項**，走 A 方案**不必安裝**。

---

## 查路由器型號（有空再做）

1. 新竹 CMD：`ipconfig` → 看 **預設閘道** IP  
2. 瀏覽器開那個 IP → 登入後台（密碼常在路由器底部貼紙）  
3. 貼紙上的 **Model** 拍下來，給 IT 或查「型號 + Wake on LAN」  

在此之前，用 **「不睡眠 + DeskIn」** 或 **「常開中繼 WoL」** 即可工作。
