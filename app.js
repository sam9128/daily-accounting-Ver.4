const DB_NAME = 'daily-book-github';
const DB_VERSION = 1;
const BACKUP_FILE_NAME = 'daily-book-backup.json';
const SYNC_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_ACCOUNTS = ['零用金', '郵局存款', '永豐存款', '台新存款', 'Line Bank', '口袋帳戶', '永豐金證券', '小姐姐VISA'];
const EXPENSE_CATEGORIES = ['食', '衣', '住', '行', '育', '樂', '醫', '用', '送'];
const CATEGORIES = [...EXPENSE_CATEGORIES, '美金', '日幣', '0050', '存', '轉'];
const CATEGORY_LABELS = { 食: '食', 衣: '衣', 住: '住', 行: '行', 育: '育', 樂: '樂', 醫: '醫', 用: '用', 送: '送', 美金: '美金', 日幣: '日幣', '0050': '0050', 存: '存', 轉: '轉' };

const app = document.querySelector('#app');
const xlsxInput = document.querySelector('#xlsxInput');
const state = { transactions: [], accounts: [], settings: {}, token: '', tokenClient: null, syncing: false };

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('transactions')) db.createObjectStore('transactions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbRead(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

async function dbAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readwrite').objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function saveSetting(key, value) { await dbPut('settings', { key, value }); state.settings[key] = value; }
function now() { return new Date().toISOString(); }
function numeric(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function money(value) { return new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(value); }
function dateOnly(value) { return String(value || '').slice(0, 10); }
function uid() { return crypto.randomUUID(); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function showNotice(message) { const old = document.querySelector('.toast'); old?.remove(); const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message; document.body.append(toast); setTimeout(() => toast.remove(), 3600); }

function activeTransactions() { return state.transactions.filter(t => !t.deleted).sort((a, b) => a.sequence - b.sequence); }

// 等價於舊 Excel 的 J:Q／BB:BF 逐列公式：保留原始輸入順序，不用日期排序。
function calculate() {
  const transactions = activeTransactions();
  const balances = Object.fromEntries(state.accounts.map(a => [a, 0]));
  let total = 0;
  for (const tx of transactions) {
    const expense = numeric(tx.expense), income = numeric(tx.income), reason = tx.reason || '';
    total += income - expense;
    for (const account of state.accounts) {
      if (tx.account === account) balances[account] += reason.startsWith('轉') ? -expense : income - expense;
      else if (reason === `轉${account}`) balances[account] += income;
    }
  }
  const latest = transactions.at(-1);
  const statisticFor = (kind) => {
    if (!latest) return emptyStats();
    const latestDate = new Date(`${dateOnly(latest.date)}T00:00:00`);
    const unit = kind === 'year' ? latestDate.getFullYear() : latestDate.getMonth();
    const rows = [];
    // 舊公式以相鄰列的 MONTH/YEAR 判斷是否歸零，因此由最後一列向前取同一連續區段。
    for (let i = transactions.length - 1; i >= 0; i--) {
      const date = new Date(`${dateOnly(transactions[i].date)}T00:00:00`);
      const matches = kind === 'year' ? date.getFullYear() === unit : date.getMonth() === unit;
      if (!matches) break;
      rows.unshift(transactions[i]);
    }
    return rows.reduce((result, tx) => {
      const delta = numeric(tx.income) - numeric(tx.expense);
      if (EXPENSE_CATEGORIES.includes(tx.category)) result.categories[tx.category] += delta;
      if (tx.category === '存') result.save += delta;
      if (tx.category === '轉') result.transfer += delta;
      return result;
    }, emptyStats());
  };
  const month = statisticFor('month'), year = statisticFor('year');
  for (const stats of [month, year]) { stats.total = Object.values(stats.categories).reduce((sum, amount) => sum + amount, 0); stats.diff = stats.total + stats.transfer; }
  return { balances, total, month, year, latest };
}

function emptyStats() { return { categories: Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c, 0])), total: 0, diff: 0, save: 0, transfer: 0 }; }

function render() {
  const { balances, total, month } = calculate();
  const txs = activeTransactions().slice(-12).reverse();
  const accountCards = state.accounts.map(a => `<article class="account-card"><span>${escapeHtml(a)}</span><strong class="${balances[a] < 0 ? 'negative' : ''}">${money(balances[a])}</strong></article>`).join('') || '<p class="empty">尚未建立帳戶；匯入舊 Excel 後會自動帶入。</p>';
  const categoryRows = EXPENSE_CATEGORIES.map((c, i) => `<div class="category-row"><span><i class="dot dot-${i}"></i>${c}</span><b>${money(Math.abs(month.categories[c]))}</b></div>`).join('');
  const max = Math.max(1, ...EXPENSE_CATEGORIES.map(c => Math.abs(month.categories[c])));
  const bars = EXPENSE_CATEGORIES.map((c, i) => `<div class="bar"><span>${c}</span><div><i class="bar-${i}" style="width:${Math.abs(month.categories[c]) / max * 100}%"></i></div></div>`).join('');
  const rows = txs.map(tx => `<tr><td>${escapeHtml(dateOnly(tx.date))}</td><td>${escapeHtml(tx.account)}</td><td>${escapeHtml(tx.category)}</td><td>${escapeHtml(tx.reason || '—')}</td><td class="negative">${tx.expense ? `−${money(numeric(tx.expense))}` : '—'}</td><td class="positive">${tx.income ? `+${money(numeric(tx.income))}` : '—'}</td><td><button class="icon-button" data-edit="${tx.id}" aria-label="編輯交易">⋯</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">尚無交易。請匯入舊帳本，或直接新增一筆。</td></tr>';
  const driveReady = Boolean(getClientId());
  app.innerHTML = `
    <aside class="sidebar"><a class="brand" href="#">日常記帳 Ver.4</a><nav><button class="nav-active">總覽</button><button data-action="focus-transactions">交易明細</button><button data-action="open-sync">資料與同步</button></nav><footer><span>本機資料庫</span><strong>${state.transactions.filter(t => !t.deleted).length} 筆交易</strong></footer></aside>
    <main><header><h1>總覽</h1><div class="sync-status"><span class="status-dot ${state.token ? 'connected' : ''}"></span>${state.token ? '已連線 Google Drive' : driveReady ? '尚未連線 Google Drive' : '尚未設定 Google OAuth'}<button class="outline" data-action="open-sync">資料與同步</button></div></header>
      <section class="summary"><article class="total-card"><span>總額</span><strong class="${total < 0 ? 'negative' : ''}">${money(total)}</strong><small>依舊試算表的收入 − 支出公式計算</small></article><section class="accounts"><div class="section-title"><h2>帳戶餘額</h2><span>按原始流水順序重新計算</span></div><div class="account-grid">${accountCards}</div></section></section>
      <section class="workspace"><article class="analysis"><div class="section-title"><h2>本月支出分析</h2><span>差額 ${money(month.diff)} · 存 ${money(month.save)}</span></div><div class="chart-area"><div class="donut" style="--p:${Math.min(100, Math.abs(month.total) / 30000 * 100)}"><span>本月支出<br><b>${money(Math.abs(month.total))}</b></span></div><div class="categories">${categoryRows}</div></div><div class="bars">${bars}</div></article>
        <form id="transactionForm" class="quick-add"><div class="section-title"><h2>快速新增交易</h2><span>離線也可記錄</span></div><label>日期<input name="date" type="date" required value="${new Date().toISOString().slice(0, 10)}"></label><label>帳戶<select name="account" required>${state.accounts.map(a => `<option>${escapeHtml(a)}</option>`).join('')}</select></label><label>分類項目<select name="category">${CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></label><label>原因備註<input name="reason" placeholder="例如：午餐"></label><div class="amounts"><label>支出<input name="expense" inputmode="decimal" type="number" min="0" step="any" placeholder="0"></label><label>收入<input name="income" inputmode="decimal" type="number" min="0" step="any" placeholder="0"></label></div><button class="primary" type="submit">新增交易</button><p>轉帳相容提示：原因填「轉目標帳戶」，並同時填支出與收入。</p></form></section>
      <section id="transactions" class="transactions"><div class="section-title"><h2>近期交易</h2><button class="text-button" data-action="open-sync">匯入／同步</button></div><div class="table-wrap"><table><thead><tr><th>日期</th><th>帳戶</th><th>分類</th><th>原因備註</th><th>支出</th><th>收入</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
    </main><dialog id="syncDialog"><form method="dialog" class="dialog-card"><button class="close" value="cancel" aria-label="關閉">×</button><h2>資料與同步</h2><p>舊 Excel 只會在此裝置讀取；匯入後資料保存於瀏覽器 IndexedDB。</p><div class="dialog-actions"><button class="primary" type="button" data-action="import">匯入舊 Excel</button><button class="outline" type="button" data-action="export">下載本機備份</button></div><hr><h3>Google Drive</h3><p>在各裝置使用同一 Google 帳號，即可下載、合併與上傳 daily-book-backup.json。</p><label>Google OAuth Client ID<input id="clientId" value="${escapeHtml(getClientId())}" placeholder="…apps.googleusercontent.com"></label><label>Google 試算表 ID（選填）<input id="spreadsheetId" value="${escapeHtml(state.settings.spreadsheetId || getStaticConfig().spreadsheetId || '')}" placeholder="僅同步到新分頁「網頁同步」"></label><div class="dialog-actions"><button class="outline" type="button" data-action="save-settings">儲存設定</button><button class="primary" type="button" data-action="connect">連線 Google Drive</button><button class="outline" type="button" data-action="sync">立即同步 Drive</button><button class="outline" type="button" data-action="sheet">同步試算表</button></div><small>純靜態網站無法在關閉後自行執行；程式開啟超過 24 小時或有異動時會自動備份。</small></form></dialog>`;
  bindEvents();
}

function getStaticConfig() { return window.DAILY_BOOK_CONFIG || {}; }
function getClientId() { return state.settings.googleClientId || getStaticConfig().googleClientId || ''; }

function bindEvents() {
  document.querySelector('#transactionForm')?.addEventListener('submit', addTransaction);
  app.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click', handleAction));
  app.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => editTransaction(el.dataset.edit)));
}

async function addTransaction(event) {
  event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
  if (!numeric(values.expense) && !numeric(values.income)) return alert('請填入支出或收入。');
  const sequence = Math.max(0, ...state.transactions.map(t => t.sequence || 0)) + 1;
  const tx = { id: uid(), sequence, date: values.date, account: values.account, category: values.category, reason: values.reason.trim(), expense: numeric(values.expense), income: numeric(values.income), updatedAt: now(), deleted: false };
  state.transactions.push(tx); await dbPut('transactions', tx); render(); scheduleBackup();
}

async function editTransaction(id) {
  const tx = state.transactions.find(t => t.id === id); if (!tx) return;
  const reason = prompt('原因備註', tx.reason || ''); if (reason === null) return;
  const expense = prompt('支出（0 表示無）', tx.expense || ''); if (expense === null) return;
  const income = prompt('收入（0 表示無）', tx.income || ''); if (income === null) return;
  Object.assign(tx, { reason, expense: numeric(expense), income: numeric(income), updatedAt: now() }); await dbPut('transactions', tx); render(); scheduleBackup();
}

function handleAction(event) {
  const action = event.currentTarget.dataset.action;
  if (action === 'open-sync') document.querySelector('#syncDialog').showModal();
  if (action === 'focus-transactions') document.querySelector('#transactions').scrollIntoView({ behavior: 'smooth' });
  if (action === 'import') xlsxInput.click();
  if (action === 'export') downloadBackup();
  if (action === 'save-settings') saveGoogleSettings();
  if (action === 'connect') connectGoogle();
  if (action === 'sync') syncDrive();
  if (action === 'sheet') syncSheet();
}

xlsxInput.addEventListener('change', async () => {
  const file = xlsxInput.files[0]; if (!file) return;
  try { await importWorkbook(file); showNotice(`已匯入 ${activeTransactions().length} 筆交易。`); render(); scheduleBackup(); } catch (error) { alert(`匯入失敗：${error.message}`); } finally { xlsxInput.value = ''; }
});

async function importWorkbook(file) {
  if (!window.XLSX) throw new Error('Excel 讀取工具尚未載入，請重新開啟網頁。');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const get = (r, c) => sheet[XLSX.utils.encode_cell({ r, c })]?.v;
  // 公式比對帳戶／分類時是精確字串比對；匯入時不可 trim，否則會改變舊帳本結果。
  const textCell = value => value === undefined || value === null ? '' : String(value);
  const localDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const headers = Array.from({ length: 58 }, (_, c) => textCell(get(0, c)));
  const importedAccounts = [...headers.slice(9, 17), headers[53], headers[54], headers[55], headers[57]].filter(Boolean);
  state.accounts = [...new Set([...state.accounts, ...importedAccounts, ...DEFAULT_ACCOUNTS])]; await saveSetting('accounts', state.accounts);
  const range = XLSX.utils.decode_range(sheet['!ref']); const imported = [];
  for (let r = 1; r <= range.e.r; r++) {
    const rawDate = get(r, 0); if (!rawDate) continue;
    const toDate = rawDate instanceof Date ? localDate(rawDate) : (typeof rawDate === 'number' ? XLSX.SSF.format('yyyy-mm-dd', rawDate) : textCell(rawDate).slice(0, 10));
    const tx = { id: `legacy-${r + 1}-${toDate}`, sequence: r + 1, date: toDate, account: textCell(get(r, 1)), category: textCell(get(r, 2)), reason: textCell(get(r, 3)), expense: numeric(get(r, 4)), income: numeric(get(r, 5)), updatedAt: now(), deleted: false };
    if (!tx.account && !tx.category && !tx.expense && !tx.income) continue;
    imported.push(tx); if (tx.account && !state.accounts.includes(tx.account)) state.accounts.push(tx.account);
  }
  if (!imported.length) throw new Error('找不到 A–F 欄交易資料。');
  const existing = new Map(state.transactions.map(tx => [tx.id, tx])); imported.forEach(tx => existing.set(tx.id, tx)); state.transactions = [...existing.values()];
  for (const tx of imported) await dbPut('transactions', tx); await saveSetting('accounts', state.accounts);
}

function backupPayload() { return { schema: 1, exportedAt: now(), accounts: state.accounts, transactions: state.transactions }; }
function downloadBackup() { const blob = new Blob([JSON.stringify(backupPayload(), null, 2)], { type: 'application/json' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `daily-book-backup-${dateOnly(now())}.json` }); a.click(); URL.revokeObjectURL(a.href); }

async function saveGoogleSettings() { await saveSetting('googleClientId', document.querySelector('#clientId').value.trim()); await saveSetting('spreadsheetId', document.querySelector('#spreadsheetId').value.trim()); alert('設定已儲存在此裝置。'); render(); document.querySelector('#syncDialog').showModal(); }

function connectGoogle() {
  const clientId = getClientId(); if (!clientId || clientId.includes('YOUR_')) return alert('請先填入 Google OAuth Client ID 並儲存。');
  if (!window.google?.accounts?.oauth2) return alert('Google 身分驗證尚未載入，請稍後再試。');
  state.tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SYNC_SCOPE, callback: response => { if (response.error) return alert(`授權失敗：${response.error}`); state.token = response.access_token; render(); document.querySelector('#syncDialog').showModal(); syncDrive(); } });
  state.tokenClient.requestAccessToken({ prompt: state.token ? '' : 'consent' });
}

async function googleFetch(url, options = {}) { if (!state.token) throw new Error('請先連線 Google Drive。'); const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${state.token}`, ...(options.headers || {}) } }); if (!response.ok) throw new Error(await response.text()); return response; }

async function findBackup() { const q = encodeURIComponent(`name='${BACKUP_FILE_NAME}' and trashed=false`); const response = await googleFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)`); return (await response.json()).files?.[0]; }
async function uploadBackup(fileId) {
  const metadata = { name: BACKUP_FILE_NAME, mimeType: 'application/json' }; const body = new FormData(); body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' })); body.append('file', new Blob([JSON.stringify(backupPayload())], { type: 'application/json' }));
  const url = fileId ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  await googleFetch(url, { method: fileId ? 'PATCH' : 'POST', body }); await saveSetting('lastBackupAt', now());
}
async function mergeBackup(remote) {
  if (!remote?.transactions) return;
  const merged = new Map(state.transactions.map(t => [t.id, t]));
  for (const tx of remote.transactions) { const current = merged.get(tx.id); if (!current || String(tx.updatedAt) > String(current.updatedAt)) merged.set(tx.id, tx); }
  state.transactions = [...merged.values()]; state.accounts = [...new Set([...(remote.accounts || []), ...state.accounts])];
  for (const tx of state.transactions) await dbPut('transactions', tx); await saveSetting('accounts', state.accounts);
}
async function syncDrive() {
  try { if (!state.token) return connectGoogle(); state.syncing = true; const existing = await findBackup(); if (existing) { const remote = await (await googleFetch(`https://www.googleapis.com/drive/v3/files/${existing.id}?alt=media`)).json(); await mergeBackup(remote); } await uploadBackup(existing?.id); render(); alert('Google Drive 已同步。'); } catch (error) { alert(`Drive 同步失敗：${error.message}`); } finally { state.syncing = false; }
}
function scheduleBackup() { if (state.token) setTimeout(() => syncDrive(), 800); }

async function syncSheet() {
  try { const spreadsheetId = state.settings.spreadsheetId || getStaticConfig().spreadsheetId; if (!spreadsheetId) return alert('請先填入 Google 試算表 ID。'); if (!state.token) return connectGoogle(); const title = '網頁同步'; const meta = await (await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`)).json(); if (!meta.sheets?.some(s => s.properties.title === title)) await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) }); const values = [['日期', '帳戶', '分類', '原因', '支出', '收入', '交易 ID'], ...activeTransactions().map(t => [dateOnly(t.date), t.account, t.category, t.reason, t.expense || '', t.income || '', t.id])]; await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${title}!A:G`)}:clear`, { method: 'POST' }); await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valueInputOption: 'RAW', data: [{ range: `${title}!A1:G${values.length}`, values }] }) }); alert('已同步到試算表「網頁同步」分頁。'); } catch (error) { alert(`試算表同步失敗：${error.message}`); }
}

async function init() { const entries = await dbAll('settings'); state.settings = Object.fromEntries(entries.map(x => [x.key, x.value])); state.accounts = state.settings.accounts || []; state.transactions = await dbAll('transactions'); render(); const last = Date.parse(state.settings.lastBackupAt || 0); if (state.token && Date.now() - last > 86400000) syncDrive(); }
init().catch(error => { app.innerHTML = `<p class="fatal">無法開啟本機資料庫：${escapeHtml(error.message)}</p>`; });
