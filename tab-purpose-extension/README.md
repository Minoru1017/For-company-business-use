# 分頁用途標記

一個不需要伺服器、帳號或外部套件的 Chrome／Microsoft Edge 擴充功能。替每個分頁加上用途，之後可從 3 個地方快速辨識：

- 分頁標題前綴，例如 `【待回覆】 公司信箱`
- 工具列圖示上的 2 字徽章
- 擴充功能內的分頁清單與用途顏色

## 安裝到公司電腦

1. 下載 `tab-purpose-extension.zip` 並解壓縮。
2. Chrome 開啟 `chrome://extensions`；Edge 開啟 `edge://extensions`。
3. 開啟右上角的「開發人員模式」。
4. 按「載入未封裝項目」，選擇解壓縮後的 `tab-purpose-extension` 資料夾。
5. 將「分頁用途標記」固定到工具列。

公司若停用「開發人員模式」，需請資訊人員透過 Chrome Enterprise 或 Edge 管理中心部署擴充功能。這是瀏覽器的公司政策限制，無法由擴充功能繞過。

## 使用方式

1. 打開要標記的分頁。
2. 點工具列上的擴充功能。
3. 輸入用途後按「套用」，或直接點常用用途。
4. 從下方清單搜尋、查看並切換所有開啟的分頁。

標記跟著目前分頁存在，重新整理後仍會保留；關閉分頁時會自動清除。`chrome://`、`edge://`、擴充功能商店等瀏覽器內建頁面禁止修改標題，但工具列徽章與清單標記仍可使用。

## 隱私與資源

- 所有資料只存在瀏覽器的工作階段儲存空間與分頁的 `sessionStorage`。
- 不連線到任何伺服器，不含追蹤碼，不讀取網頁內容。
- 使用原生 HTML、CSS、JavaScript，沒有執行階段依賴。
- 權限只有 `activeTab`、`scripting`、`storage` 與 `tabs`；程式只在你主動標記的分頁注入標題前綴，不要求全網站常駐權限。

## 打包

在專案根目錄執行：

```bash
npm run package:tab-extension
```

成品會輸出到 `artifacts/tab-purpose-extension.zip`。
