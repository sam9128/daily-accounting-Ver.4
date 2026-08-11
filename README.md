# 日常記帳 Ver.4

純靜態、離線優先的 React 記帳程式，部署於 GitHub Pages。

## 資料架構

- IndexedDB 是唯一主資料庫，保存交易與設定。
- 公開網站與 GitHub 原始碼完全不包含歷史帳目；新裝置以空資料庫開始。
- 第一次開啟空資料庫時，程式會主動顯示 Google Drive 私密還原，也可選擇本機 JSON 私密備份。
- 已有 IndexedDB 資料的裝置不會被清空或重複匯入。
- 帳戶餘額、分類累計、日／月／年統計全部由 `src/lib/ledger.js` 即時計算。
- Excel 不再是執行時依賴；專案也不包含 Excel 解析套件或匯入介面。

## 同步與備份

- Google Drive 保存 schema 5 的 JSON 備份，並可讀取舊 schema 4 備份。
- 同步採交易 ID 合併，`updatedAt` 較新的版本優先。
- OAuth 權杖只保存在記憶體，不寫入 IndexedDB 或 LocalStorage。
- 空裝置若在 Drive 找不到備份會停止操作，不會建立或上傳空帳本。
- 本機 JSON 安全備份仍可下載；試算表匯出功能留待後續實作。
- 私密轉換檔請放在 `.private-data/`；該目錄已被 Git 忽略，禁止提交。

## 安裝手機版（PWA）

- 正式站以 standalone 模式安裝；Android／桌面 Chrome 會在設定 →「資料」→「安裝手機版」顯示安裝按鈕。
- iOS 不支援 `beforeinstallprompt`，該卡片會改為提示 Safari「分享」→「加入主畫面」。
- 圖示由 `logo.png` 產生，放在 `public/`：`pwa-192/512.png`（一般）、`pwa-maskable-192/512.png`（Android 適應式圖示）、`apple-touch-icon.png`、`favicon.png`。
- 換 logo 時要同時更新這幾個檔案；Chrome 需要至少一張 192px 以上的 PNG 才會判定為可安裝。

## 本機開發

```bash
pnpm install
pnpm run dev
```

驗證資料運算與正式建置：

```bash
pnpm run validate
```

## Google Drive 設定

在 GitHub Actions／Pages 設定 `VITE_GOOGLE_CLIENT_ID`，並在 Google Cloud Console 將正式 Pages 網址加入 OAuth 網頁應用程式的 Authorized JavaScript origins。只需啟用 Google Drive API，不再需要 Google Sheets API。
