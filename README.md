# 日常記帳 Ver.4（GitHub Pages 版）

這是純靜態、離線優先的記帳程式。交易主資料存在瀏覽器 IndexedDB；Google Drive 是跨裝置同步備份，Google 試算表僅為可選鏡像，不再參與計算。

## 第一次部署

1. 在 Google Cloud Console 建立「網頁應用程式」OAuth 2.0 Client ID，將 GitHub Pages 網址和本機測試網址加到 *Authorized JavaScript origins*。
2. 啟用 Google Drive API 與 Google Sheets API。
3. 將 `config.example.js` 複製為 `config.js`，填入 Client ID；`config.js` 已被忽略，不會提交。
4. 將專案根目錄發布到 GitHub Pages。首次開啟後，從「資料與同步」匯入舊 `.xlsx`，再按「連線 Google Drive」。

## 資料與計算相容性

匯入器只讀取舊帳本的交易資料與帳戶標題，並保留原始列順序。運算等價於舊表：一般交易為收入減支出；原因以 `轉` 開頭時從來源帳戶扣支出；原因恰為 `轉{目標帳戶}` 時向目標帳戶加收入。月／年類別統計、差額與「存」也沿用原公式的序列規則。

## 同步與備份

- 每次異動會寫入 IndexedDB，並在已連線時排程同步。
- 開啟程式後超過 24 小時會再備份一次；瀏覽器關閉期間，純靜態網站不能自行執行排程。
- Drive 檔案只包含此應用程式建立的 `daily-book-backup.json`；資料以交易 UUID 合併，最近修改優先。
- 「同步試算表」會建立或更新 `網頁同步` 分頁，不會改寫舊的 `存款` 工作表。
