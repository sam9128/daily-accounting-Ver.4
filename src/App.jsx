import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { all, put, settingsObject } from './lib/db.js';
import { calculate, categories, defaultAccounts, expenseCategories, num } from './lib/ledger.js';
import { connectDrive, downloadBackup, mergeTransactions, uploadBackup } from './lib/drive.js';
import { loadPreferences, savePreferences } from './lib/preferences.js';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const money = value => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(value);
const today = () => new Date().toLocaleDateString('sv-SE');
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const blankForm = preferences => ({ date: today(), account: preferences.lastAccount || defaultAccounts[0], category: preferences.lastCategory || categories[0], reason: '', expense: '', income: '' });

function downloadJson(payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `daily-book-ver4-${today()}.json` });
  link.click();
  URL.revokeObjectURL(url);
}

function QuickTransactionForm({ accounts, preferences, selectedAccount, onSave }) {
  const [form, setForm] = useState(() => blankForm(preferences));
  useEffect(() => setForm(current => ({ ...current, account: accounts.includes(current.account) ? current.account : accounts[0] })), [accounts]);
  useEffect(() => { if (selectedAccount) setForm(current => ({ ...current, account: selectedAccount })); }, [selectedAccount]);
  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = async event => {
    event.preventDefault();
    const saved = await onSave(form);
    if (saved) setForm(current => ({ ...blankForm({ ...preferences, lastAccount: current.account, lastCategory: current.category }), account: current.account, category: current.category }));
  };
  return <form className="quick-form" onSubmit={submit}>
    <div className="form-heading"><h2>新增交易</h2></div>
    <label>日期<input name="date" type="date" value={form.date} onChange={change} required /></label>
    <label>帳戶<select name="account" value={form.account} onChange={change}>{accounts.map(account => <option key={account}>{account}</option>)}</select></label>
    <label className="wide">分類<select name="category" value={form.category} onChange={change}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
    <label className="wide">原因備註<input name="reason" value={form.reason} onChange={change} placeholder="例如：晚餐、薪資、轉帳" /></label>
    <label className="expense">支出 AMOUNT<input name="expense" inputMode="decimal" type="number" min="0" step="any" value={form.expense} onChange={change} placeholder="− 0" /></label>
    <label className="income">收入 AMOUNT<input name="income" inputMode="decimal" type="number" min="0" step="any" value={form.income} onChange={change} placeholder="＋ 0" /></label>
    <button className="primary" type="submit">確認送出 <span>↗</span></button>
  </form>;
}

function SyncDialog({ onClose, onImport, onBackup, onSync, syncing, lastSynced }) {
  return <dialog open aria-labelledby="sync-title">
    <button className="close" onClick={onClose} aria-label="關閉">×</button>
    <h2 id="sync-title">資料與同步</h2>
    <p className="muted">帳本先安全保存在本機 IndexedDB；Google Drive 只保存一份版本化 JSON 備份。每筆資料以最後修改時間合併，並不保存 OAuth 權杖。</p>
    <label className="file-picker">匯入舊版 Excel<input type="file" accept=".xlsx,.xls" onChange={event => event.target.files[0] && onImport(event.target.files[0])} /></label>
    <button onClick={onBackup}>下載本機 JSON 備份</button>
    <div className="sync-status"><span className={CLIENT_ID ? 'online' : 'offline'}></span>{CLIENT_ID ? 'Google Drive 已設定，可連線同步' : '尚未設定 GitHub Pages 的 VITE_GOOGLE_CLIENT_ID'}</div>
    <button className="primary" disabled={!CLIENT_ID || syncing} onClick={onSync}>{syncing ? '正在合併並同步…' : '連線 Google Drive 並同步'}</button>
    {lastSynced && <small className="muted">上次同步：{new Date(lastSynced).toLocaleString('zh-TW')}</small>}
  </dialog>;
}

function StatsDialog({ ledger, accounts, transactions, onClose, onEdit }) {
  const [mode, setMode] = useState('month');
  const [account, setAccount] = useState('all');
  const [category, setCategory] = useState('all');
  const stats = mode === 'year' ? ledger.year : ledger.month;
  const visible = useMemo(() => ledger.rows.slice().reverse().filter(record => (account === 'all' || record.account === account) && (category === 'all' || record.category === category)), [ledger.rows, account, category]);
  return <dialog open className="stats-dialog" aria-labelledby="stats-title"><button className="close" onClick={onClose} aria-label="關閉">×</button><h2 id="stats-title">統計與流水</h2><div className="mode-tabs"><button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>月</button><button className={mode === 'year' ? 'active' : ''} onClick={() => setMode('year')}>年</button><button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>流水</button></div>{mode !== 'all' ? <section className="stats-content"><strong>{money(Math.abs(stats.total))}</strong><p>支出 · 差額 {money(stats.diff)} · 儲蓄 {money(stats.save)}</p>{expenseCategories.map(item => <div className="stat-row" key={item}><span>{item}</span><i style={{ width: `${Math.min(100, Math.abs(stats.values[item]) / Math.max(1, Math.abs(stats.total)) * 100)}%` }}></i><b>{money(Math.abs(stats.values[item]))}</b></div>)}</section> : <section className="logs"><div className="filters"><select value={account} onChange={event => setAccount(event.target.value)}><option value="all">所有帳戶</option>{accounts.map(item => <option key={item}>{item}</option>)}</select><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">所有分類</option>{categories.map(item => <option key={item}>{item}</option>)}</select></div>{visible.length ? visible.map(record => <button className="log-row" key={record.id} onClick={() => onEdit(record)}><span>{record.date} · {record.category}</span><b>{record.reason || '未註記'}</b><small>{record.account}</small><em className={record.expense ? 'out' : 'in'}>{record.expense ? `− ${money(record.expense)}` : `＋ ${money(record.income)}`}</em></button>) : <p className="muted">目前沒有符合條件的流水。</p>}</section>}</dialog>;
}

function EditDialog({ record, accounts, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...record, expense: record.expense || '', income: record.income || '' }));
  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = event => { event.preventDefault(); onSave({ ...form, expense: num(form.expense), income: num(form.income) }); };
  return <dialog open className="edit-dialog" aria-labelledby="edit-title"><button className="close" onClick={onClose} aria-label="關閉">×</button><h2 id="edit-title">修改流水</h2><form onSubmit={submit}><input name="date" type="date" value={form.date} onChange={change}/><select name="account" value={form.account} onChange={change}>{accounts.map(item => <option key={item}>{item}</option>)}</select><select name="category" value={form.category} onChange={change}>{categories.map(item => <option key={item}>{item}</option>)}</select><input name="reason" value={form.reason} onChange={change} placeholder="原因備註"/><input name="expense" type="number" value={form.expense} onChange={change} placeholder="支出"/><input name="income" type="number" value={form.income} onChange={change} placeholder="收入"/><button className="primary">儲存修改</button></form></dialog>;
}

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState({});
  const [preferences, setPreferences] = useState(loadPreferences);
  const [notice, setNotice] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [update, setUpdate] = useState(false);
  const [mobileView, setMobileView] = useState('overview');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [statsOpen, setStatsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const accounts = settings.accounts || defaultAccounts;
  const ledger = useMemo(() => calculate(transactions, accounts), [transactions, accounts]);
  const persistSetting = useCallback(async (key, value) => { await put('settings', { key, value }); setSettings(current => ({ ...current, [key]: value })); }, []);
  const persistTransactions = useCallback(async records => { await Promise.all(records.map(record => put('transactions', record))); setTransactions(records); }, []);

  useEffect(() => {
    Promise.all([all('transactions'), all('settings')]).then(([records, saved]) => { setTransactions(records); setSettings(settingsObject(saved)); });
    const listener = () => setUpdate(true);
    window.addEventListener('book-update-ready', listener);
    return () => window.removeEventListener('book-update-ready', listener);
  }, []);

  const addTransaction = async values => {
    if (!num(values.expense) && !num(values.income)) { setNotice('請填入支出或收入。'); return false; }
    const record = { id: crypto.randomUUID(), sequence: Math.max(0, ...transactions.map(item => item.sequence || 0)) + 1, ...values, expense: num(values.expense), income: num(values.income), updatedAt: new Date().toISOString(), revision: 1, deleted: false };
    await persistTransactions([...transactions, record]);
    const next = { ...preferences, lastAccount: values.account, lastCategory: values.category };
    setPreferences(next); savePreferences(next);
    setNotice('已儲存到這台裝置。');
    setMobileView('transactions');
    return true;
  };

  const saveEditedTransaction = async values => {
    if (!num(values.expense) && !num(values.income)) { setNotice('請填入支出或收入。'); return; }
    const record = { ...values, updatedAt: new Date().toISOString(), revision: (values.revision || 0) + 1 };
    await persistTransactions(transactions.map(item => item.id === record.id ? record : item));
    setEditing(null);
    setNotice('交易已修改並保存在本機。');
  };

  const importBook = async file => {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const get = (row, column) => sheet[XLSX.utils.encode_cell({ r: row, c: column })]?.v;
    const text = value => value == null ? '' : String(value);
    const headers = Array.from({ length: 58 }, (_, column) => text(get(0, column)));
    const importedAccounts = [...new Set([...accounts, ...headers.slice(9, 17), headers[53], headers[54], headers[55], headers[57]].filter(Boolean))];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const imported = [];
    for (let row = 1; row <= range.e.r; row += 1) {
      const rawDate = get(row, 0);
      if (!rawDate) continue;
      const date = rawDate instanceof Date ? localDate(rawDate) : typeof rawDate === 'number' ? XLSX.SSF.format('yyyy-mm-dd', rawDate) : text(rawDate).slice(0, 10);
      const record = { id: `legacy-${row + 1}-${date}`, sequence: row + 1, date, account: text(get(row, 1)), category: text(get(row, 2)), reason: text(get(row, 3)), expense: num(get(row, 4)), income: num(get(row, 5)), updatedAt: new Date().toISOString(), revision: 1, deleted: false };
      if (record.account || record.category || record.expense || record.income) imported.push(record);
    }
    const merged = mergeTransactions(transactions, imported);
    await persistTransactions(merged);
    await persistSetting('accounts', importedAccounts);
    setNotice(`已匯入 ${imported.length} 筆舊帳本交易；原始順序已保留。`);
  };

  const backupPayload = () => ({ schema: 4, accounts, transactions, exportedAt: new Date().toISOString() });
  const syncDrive = async () => {
    setSyncing(true);
    try {
      await connectDrive(CLIENT_ID);
      const remote = await downloadBackup();
      const merged = mergeTransactions(transactions, remote?.transactions || []);
      const mergedAccounts = [...new Set([...accounts, ...(remote?.accounts || [])])];
      await persistTransactions(merged);
      await persistSetting('accounts', mergedAccounts);
      await uploadBackup({ schema: 4, accounts: mergedAccounts, transactions: merged, exportedAt: new Date().toISOString() });
      const next = { ...preferences, lastDriveSync: new Date().toISOString() };
      setPreferences(next); savePreferences(next);
      setNotice(remote ? `已合併 ${merged.length} 筆資料並同步到 Drive。` : '已在 Google Drive 建立第一份備份。');
    } catch (error) { setNotice(error.message || '同步未完成，請稍後再試。'); }
    finally { setSyncing(false); }
  };

  return <><aside><b>日常記帳 <em>Ver.4</em></b><button>總覽</button><button onClick={() => document.querySelector('#transactions')?.scrollIntoView({ behavior: 'smooth' })}>交易明細</button><button onClick={() => setSyncOpen(true)}>資料與同步</button><small>{ledger.rows.length} 筆交易</small></aside><main className={`view-${mobileView}`}>
    <header><h1>財務總覽</h1><button onClick={() => setSyncOpen(true)}>資料與同步</button></header>
    {update && <div className="update">已有新版可用。<button onClick={() => location.reload()}>立即更新</button></div>}
    <section className="summary"><button className="total-card" onClick={() => setStatsOpen(true)}><span>總計餘額 <i>›</i></span><strong>{money(ledger.total)}</strong><small><b>日支出</b> {money(Math.abs(ledger.month.total))}<br /><b className="positive">月收入</b> {money(ledger.month.diff + Math.abs(ledger.month.total))}</small></button><article className="accounts"><h2>帳戶餘額</h2><div>{accounts.map(account => <button className={selectedAccount === account ? 'selected' : ''} key={account} onClick={() => { setSelectedAccount(account); setMobileView('add'); }}><span>{account}</span><b className={ledger.balances[account] < 0 ? 'negative' : ''}>{money(ledger.balances[account])}</b></button>)}</div></article></section>
    <section className="grid"><article className="analysis"><h2>本月支出</h2><strong className="spent">{money(Math.abs(ledger.month.total))}</strong><p>差額 {money(ledger.month.diff)} · 儲蓄 {money(ledger.month.save)}</p>{expenseCategories.map(category => <div className="category" key={category}><span>{category}</span><i style={{ width: `${Math.min(100, Math.abs(ledger.month.values[category]) / 5000 * 100)}%` }}></i><b>{money(Math.abs(ledger.month.values[category]))}</b></div>)}</article><QuickTransactionForm accounts={accounts} preferences={preferences} selectedAccount={selectedAccount} onSave={addTransaction} /></section>
    <section id="transactions"><div className="section-heading"><h2>近期交易</h2><button onClick={() => setSyncOpen(true)}>管理資料</button></div><div className="table-wrap"><table><thead><tr><th>日期</th><th>帳戶</th><th>分類</th><th>原因</th><th>支出</th><th>收入</th></tr></thead><tbody>{ledger.rows.slice(-30).reverse().map(record => <tr key={record.id}><td>{record.date}</td><td>{record.account}</td><td>{record.category}</td><td>{record.reason || '—'}</td><td className="out">{record.expense ? money(record.expense) : '—'}</td><td className="in">{record.income ? money(record.income) : '—'}</td></tr>)}</tbody></table></div></section>
    <nav className="mobile-nav" aria-label="手機導覽"><button className={mobileView === 'overview' ? 'active' : ''} onClick={() => setMobileView('overview')}>總覽</button><button className={mobileView === 'add' ? 'active' : ''} onClick={() => setMobileView('add')}>新增</button><button className={mobileView === 'transactions' ? 'active' : ''} onClick={() => setMobileView('transactions')}>交易</button><button onClick={() => setSyncOpen(true)}>同步</button></nav>
    {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} onImport={importBook} onBackup={() => downloadJson(backupPayload())} onSync={syncDrive} syncing={syncing} lastSynced={preferences.lastDriveSync} />}{statsOpen && <StatsDialog ledger={ledger} accounts={accounts} transactions={transactions} onClose={() => setStatsOpen(false)} onEdit={record => { setStatsOpen(false); setEditing(record); }} />}{editing && <EditDialog record={editing} accounts={accounts} onClose={() => setEditing(null)} onSave={saveEditedTransaction} />}
    {notice && <div className="toast" onAnimationEnd={() => setNotice('')}>{notice}</div>}
  </main></>;
}
