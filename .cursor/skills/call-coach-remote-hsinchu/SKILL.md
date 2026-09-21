---
name: call-coach-remote-hsinchu
description: |
  公司電腦連新竹 GPU 主機：標準做法只用 Tailscale + DeskIn（不用 CallCoachCompanyWake）。
  使用者問遠端、喚醒、DeskIn、新竹桌面、休眠時必讀。
---

# 新竹主機遠端（Tailscale + DeskIn）

**標準答案（A）**：不裝 Call Coach 自製喚醒 App。兩套軟體即可。

| 軟體 | 新竹 GPU PC | 公司 PC |
|------|-------------|---------|
| [Tailscale](https://tailscale.com/download) | 安裝、登入同一帳號 | 同左 |
| DeskIn | 安裝、開機自啟、綁定裝置 | 同左，用 DeskIn 連新竹 |

Call Coach 助手只負責 **轉錄 / Worker**；遠端桌面與開機與 Call Coach 分開。

## 日常使用（新竹已開機）

1. 公司 PC 開 **DeskIn** → 選新竹那台 → 連線。  
2. 需要 GPU 轉錄時，在新竹上開 Call Coach 助手或 Worker（與 DeskIn 無關）。

## 新竹要「離開」時

- **最簡單**：只關螢幕或 Windows「關閉顯示器」，**不要睡眠/關機** → 公司隨時 DeskIn 連線。  
- 若要 **睡眠**以省電：須先做好 **Wake-on-LAN**（見下），否則公司無法叫醒。

## 喚醒（WoL）— 路由器型號未知時

Magic Packet **無法從公司網路直接丟到新竹家裡**（除非路由器特別設定）。實務三选一：

### 做法 1（推薦）：家裡有一台「常開」小主機代發 WoL

例如 NAS、舊筆電、Raspberry Pi（接家裡 **有線** 網路）：

1. 常開機裝 **Tailscale**。  
2. 安裝 WoL 工具（Linux：`wakeonlan` / `etherwake`；或 [Tailscale + UpSnap](https://tailscale.com/blog/wake-on-lan-tailscale-upsnap)）。  
3. 公司端 **SSH 進 Tailscale 上的這台** → 對新竹 PC 的 **MAC** 發 WoL。  
4. 新竹 PC 醒後 → **DeskIn** 連線。

新竹 GPU 本機可先查 MAC：CMD → `getmac`（記有線那張，例 `AA-BB-…`）。

### 做法 2：Tailscale 用戶端內建 WoL（若你的方案有）

部分 Tailscale 版本／ACL 支援對子網 peer 發 WoL。在公司 PC 打開 Tailscale → 找新竹機器 → 看是否有 **Wake** / **Send WoL**。沒有就改用做法 1。

### 做法 3：路由器 WoL（等你知道型號再設）

1. 查路由器：新竹 PC 執行 `ipconfig` → **預設閘道**（常 `192.168.1.1`）→ 瀏覽器登入；或看機身貼紙品牌型號。  
2. 後台找 **Wake on LAN** / **網路工具** → 填新竹 PC 的 MAC。  
3. 是否支援「從外網 WoL」因品牌而異；不確定時仍以 **做法 1** 最穩。

## 新竹 PC 必做（WoL 才有效）

1. **BIOS**：Wake on LAN / Power On By PCI-E → Enabled。  
2. **Windows**：裝置管理員 → 有線網卡 → 內容 → 電源管理 → 允許這個裝置喚醒電腦；進階 → **Wake on Magic Packet** → Enabled。  
3. 尽量 **有線** 接路由器（Wi‑Fi 休眠喚醒不可靠）。  
4. Tailscale 設 **開機自啟**（醒來後公司才能用 100.x 連）。

## 不要用

- 除非使用者明確要進階：repo 內 `CallCoachCompanyWake.exe` / `host agent`（較複雜）。  
- 不要把 WoL 埠轉發到公網而不加 VPN（不安全）。

## 故障速查

| 現象 | 檢查 |
|------|------|
| DeskIn 連不上 | 新竹是否開機、DeskIn 是否執行、是否同一 DeskIn 帳號 |
| Tailscale 離線 | 新竹是否睡眠/關機；需 WoL 或改為不睡眠 |
| WoL 無效 | BIOS/網卡 WoL、MAC 是否填錯、是否需 LAN 中繼代發 |
| 只想轉錄 | 新竹 Worker + 公司助手 **remote** 模式，不需 DeskIn |
