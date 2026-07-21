import { useCallback, useEffect, useMemo, useState } from 'react';
import { all, initializeDatabase, put, putMany, settingsObject } from './lib/db.js';
import { calculate, categories, defaultAccounts, expenseCategories, num } from './lib/ledger.js';
import { connectDrive, downloadBackup, mergeTransactions, uploadBackup } from './lib/drive.js';
import { loadPreferences, savePreferences } from './lib/preferences.js';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const money = value => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(value);
const plainMoney = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(value);
const today = () => new Date().toLocaleDateString('sv-SE');
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
    <label className="wide">分類項目<select name="category" value={form.category} onChange={change}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
    <label className="wide">原因<input name="reason" value={form.reason} onChange={change} placeholder="原因備註" /></label>
    <label className="expense">支出 AMOUNT<input name="expense" inputMode="decimal" type="number" min="0" step="any" value={form.expense} onChange={change} placeholder="− 0" /></label>
    <label className="income">收入 AMOUNT<input name="income" inputMode="decimal" type="number" min="0" step="any" value={form.income} onChange={change} placeholder="＋ 0" /></label>
    <button className="primary" type="submit">確認送出 <span>↗</span></button>
  </form>;
}

function SyncDialog({ isEmpty, onClose, onBackup, onRestoreFile, onSync, syncing, lastSynced }) {
  return <dialog open aria-labelledby="sync-title">
    <button className="close" onClick={onClose} aria-label="關閉">×</button>
    <h2 id="sync-title">資料與同步</h2>
    <p className="muted">{isEmpty ? '這台裝置尚無帳目。請登入 Google Drive 私密還原；資料只會寫入這台裝置的 IndexedDB。' : 'IndexedDB 是目前唯一主資料庫；Google Drive 只保存版本化 JSON 私密備份。每筆資料依最後修改時間合併，OAuth 權杖不會寫入裝置。'}</p>
    <div className="sync-status"><span className="online"></span>歷史帳目不包含在公開網站與 GitHub 原始碼中</div>
    {isEmpty
      ? <label className="file-picker">或從本機私密備份還原<input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) onRestoreFile(file); event.target.value = ''; }} /></label>
      : <button onClick={onBackup}>下載資料庫安全備份</button>}
    <div className="sync-status"><span className={CLIENT_ID ? 'online' : 'offline'}></span>{CLIENT_ID ? 'Google Drive 已設定，可連線同步' : '尚未設定 GitHub Pages 的 VITE_GOOGLE_CLIENT_ID'}</div>
    <button className="primary" disabled={!CLIENT_ID || syncing} onClick={onSync}>{syncing ? '正在安全處理資料…' : isEmpty ? '登入 Google Drive 並還原' : '連線 Google Drive 並同步'}</button>
    {lastSynced && <small className="muted">上次同步：{new Date(lastSynced).toLocaleString('zh-TW')}</small>}
  </dialog>;
}

function StatsDialog({ ledger, accounts, onClose, onEdit, onSync }) {
  const [mode, setMode] = useState('month');
  const [account, setAccount] = useState('all');
  const [category, setCategory] = useState('all');
  const stats = mode === 'year' ? ledger.year : ledger.month;
  const visible = useMemo(() => ledger.rows.slice().reverse().filter(record => (account === 'all' || record.account === account) && (category === 'all' || record.category === category)), [ledger.rows, account, category]);
  return <dialog open className="stats-dialog" aria-labelledby="stats-title"><button className="close" onClick={onClose} aria-label="關閉">×</button><h2 id="stats-title">統計與流水</h2><div className="mode-tabs"><button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>月</button><button className={mode === 'year' ? 'active' : ''} onClick={() => setMode('year')}>年</button><button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>流水</button></div><button className="stats-sync" onClick={onSync}>資料與同步</button>{mode !== 'all' ? <section className="stats-content"><strong>{money(Math.abs(stats.total))}</strong><p>支出 · 差額 {money(stats.diff)} · 儲蓄 {money(stats.save)}</p>{expenseCategories.map(item => <div className="stat-row" key={item}><span>{item}</span><i style={{ width: `${Math.min(100, Math.abs(stats.values[item]) / Math.max(1, Math.abs(stats.total)) * 100)}%` }}></i><b>{money(Math.abs(stats.values[item]))}</b></div>)}</section> : <section className="logs"><div className="filters"><select value={account} onChange={event => setAccount(event.target.value)}><option value="all">所有帳戶</option>{accounts.map(item => <option key={item}>{item}</option>)}</select><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">所有分類</option>{categories.map(item => <option key={item}>{item}</option>)}</select></div>{visible.length ? visible.map(record => <button className="log-row" key={record.id} onClick={() => onEdit(record)}><span>{record.date} · {record.category}</span><b>{record.reason || '未註記'}</b><small>{record.account}</small><em className={record.expense ? 'out' : 'in'}>{record.expense ? `− ${money(record.expense)}` : `＋ ${money(record.income)}`}</em></button>) : <p className="muted">目前沒有符合條件的流水。</p>}</section>}</dialog>;
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
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseError, setDatabaseError] = useState('');
  const [preferences, setPreferences] = useState(loadPreferences);
  const [notice, setNotice] = useState('');
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [update, setUpdate] = useState(false);
  const [mobileView, setMobileView] = useState('add');
  const [selectedAccount, setSelectedAccount] = useState(defaultAccounts[0]);
  const [statsOpen, setStatsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const accounts = settings.accounts || defaultAccounts;
  const ledger = useMemo(() => calculate(transactions, accounts), [transactions, accounts]);
  const persistSetting = useCallback(async (key, value) => { await put('settings', { key, value }); setSettings(current => ({ ...current, [key]: value })); }, []);
  const persistTransactions = useCallback(async records => { await putMany('transactions', records); setTransactions(records); }, []);

  useEffect(() => {
    let active = true;
    initializeDatabase()
      .then(() => Promise.all([all('transactions'), all('settings')]))
      .then(([records, saved]) => {
        if (!active) return;
        setTransactions(records);
        setSettings(settingsObject(saved));
        setDatabaseReady(true);
        if (records.length === 0) setSyncOpen(true);
      })
      .catch(error => {
        if (!active) return;
        setDatabaseError(error.message || 'IndexedDB 初始化失敗');
        setDatabaseReady(true);
      });
    const listener = () => setUpdate(true);
    window.addEventListener('book-update-ready', listener);
    return () => { active = false; window.removeEventListener('book-update-ready', listener); };
  }, []);

  const addTransaction = async values => {
    if (!num(values.expense) && !num(values.income)) { setNotice('請填入支出或收入。'); return false; }
    const record = { id: crypto.randomUUID(), sequence: Math.max(0, ...transactions.map(item => item.sequence || 0)) + 1, ...values, expense: num(values.expense), income: num(values.income), updatedAt: new Date().toISOString(), revision: 1, deleted: false };
    await put('transactions', record);
    setTransactions(current => [...current, record]);
    const next = { ...preferences, lastAccount: values.account, lastCategory: values.category };
    setPreferences(next); savePreferences(next);
    setNotice('已儲存到這台裝置。');
    setMobileView('transactions');
    return true;
  };

  const saveEditedTransaction = async values => {
    if (!num(values.expense) && !num(values.income)) { setNotice('請填入支出或收入。'); return; }
    const record = { ...values, updatedAt: new Date().toISOString(), revision: (values.revision || 0) + 1 };
    await put('transactions', record);
    setTransactions(current => current.map(item => item.id === record.id ? record : item));
    setEditing(null);
    setNotice('交易已修改並保存在本機。');
  };

  const backupPayload = () => ({ schema: 5, accounts, transactions, exportedAt: new Date().toISOString() });
  const restoreLocalBackup = async file => {
    try {
      const payload = JSON.parse(await file.text());
      if (![4, 5].includes(payload?.schema) || !Array.isArray(payload.transactions) || payload.transactions.length === 0) throw new Error('本機備份格式不相容或沒有交易資料。');
      if (payload.transactions.some(record => !record?.id || !record?.date || !record?.account || !record?.category)) throw new Error('本機備份缺少必要的交易欄位。');
      const restored = mergeTransactions(transactions, payload.transactions);
      const restoredAccounts = [...new Set([...accounts, ...(Array.isArray(payload.accounts) ? payload.accounts : []), ...payload.transactions.map(record => record.account)])];
      await persistTransactions(restored);
      await persistSetting('accounts', restoredAccounts);
      setNotice(`已從本機私密備份還原 ${restored.length} 筆資料。`);
      setSyncOpen(false);
    } catch (error) {
      setNotice(error.message || '無法讀取本機私密備份。');
    }
  };
  const syncDrive = async () => {
    setSyncing(true);
    try {
      await connectDrive(CLIENT_ID);
      const remote = await downloadBackup();
      if (transactions.length === 0 && (!remote || remote.transactions.length === 0)) throw new Error('Google Drive 找不到可還原的帳本備份，請改用本機私密備份。');
      const merged = mergeTransactions(transactions, remote?.transactions || []);
      const mergedAccounts = [...new Set([...accounts, ...(remote?.accounts || [])])];
      await persistTransactions(merged);
      await persistSetting('accounts', mergedAccounts);
      await uploadBackup({ schema: 5, accounts: mergedAccounts, transactions: merged, exportedAt: new Date().toISOString() });
      const next = { ...preferences, lastDriveSync: new Date().toISOString() };
      setPreferences(next); savePreferences(next);
      setNotice(remote ? `已合併 ${merged.length} 筆資料並同步到 Drive。` : '已在 Google Drive 建立第一份備份。');
      setSyncOpen(false);
    } catch (error) { setNotice(error.message || '同步未完成，請稍後再試。'); }
    finally { setSyncing(false); }
  };

  if (!databaseReady) return <main className="database-state"><strong>正在載入本機帳本…</strong><span>IndexedDB 初始化中</span></main>;
  if (databaseError) return <main className="database-state error"><strong>無法開啟帳本</strong><span>{databaseError}</span><button className="primary" onClick={() => location.reload()}>重新載入</button></main>;

  return <><aside><b>日常記帳 <em>Ver.4</em></b><button>總覽</button><button onClick={() => document.querySelector('#transactions')?.scrollIntoView({ behavior: 'smooth' })}>交易明細</button><button onClick={() => setSyncOpen(true)}>資料與同步</button><small>{ledger.rows.length} 筆交易</small></aside><main className={`view-${mobileView}`}>
    <header><h1>財務總覽</h1><button onClick={() => setSyncOpen(true)}>資料與同步</button></header>
    {update && <div className="update">已有新版可用。<button onClick={() => location.reload()}>立即更新</button></div>}
    <section className="summary"><button className="total-card" onClick={() => setStatsOpen(true)}><span>總計餘額 <i>›</i></span><strong><span className="desktop-value">{money(ledger.total)}</span><span className="mobile-value">{plainMoney(ledger.total)}</span></strong><small><span className="desktop-value"><b>日支出</b> {money(Math.abs(ledger.day.total))}<br /><b className="positive">月收入</b> {money(ledger.month.save)}</span><span className="mobile-value"><span className="daily"><b>日支出</b>{plainMoney(ledger.day.total)}</span><span className="monthly"><b>月收入</b>{plainMoney(ledger.month.save)}</span></span></small></button><article className="accounts"><h2>帳戶餘額</h2><div>{accounts.map(account => <button className={selectedAccount === account ? 'selected' : ''} key={account} onClick={() => { setSelectedAccount(account); setMobileView('add'); }}><span>{account}</span><b className={ledger.balances[account] < 0 ? 'negative' : ''}><span className="desktop-value">{money(ledger.balances[account])}</span><span className="mobile-value">{plainMoney(ledger.balances[account])}</span></b></button>)}</div></article></section>
    <section className="grid"><article className="analysis"><h2>本月支出</h2><strong className="spent">{money(Math.abs(ledger.month.total))}</strong><p>差額 {money(ledger.month.diff)} · 儲蓄 {money(ledger.month.save)}</p>{expenseCategories.map(category => <div className="category" key={category}><span>{category}</span><i style={{ width: `${Math.min(100, Math.abs(ledger.month.values[category]) / 5000 * 100)}%` }}></i><b>{money(Math.abs(ledger.month.values[category]))}</b></div>)}</article><QuickTransactionForm accounts={accounts} preferences={preferences} selectedAccount={selectedAccount} onSave={addTransaction} /></section>
    <section id="transactions"><div className="section-heading"><h2>近期交易</h2><button onClick={() => setSyncOpen(true)}>管理資料</button></div><div className="table-wrap"><table><thead><tr><th>日期</th><th>帳戶</th><th>分類</th><th>原因</th><th>支出</th><th>收入</th></tr></thead><tbody>{ledger.rows.slice(-30).reverse().map(record => <tr key={record.id}><td>{record.date}</td><td>{record.account}</td><td>{record.category}</td><td>{record.reason || '—'}</td><td className="out">{record.expense ? money(record.expense) : '—'}</td><td className="in">{record.income ? money(record.income) : '—'}</td></tr>)}</tbody></table></div></section>
    <nav className="mobile-nav" aria-label="手機導覽"><button className={mobileView === 'overview' ? 'active' : ''} onClick={() => setMobileView('overview')}>總覽</button><button className={mobileView === 'add' ? 'active' : ''} onClick={() => setMobileView('add')}>新增</button><button className={mobileView === 'transactions' ? 'active' : ''} onClick={() => setMobileView('transactions')}>交易</button><button onClick={() => setSyncOpen(true)}>同步</button></nav>
    {syncOpen && <SyncDialog isEmpty={transactions.length === 0} onClose={() => setSyncOpen(false)} onBackup={() => downloadJson(backupPayload())} onRestoreFile={restoreLocalBackup} onSync={syncDrive} syncing={syncing} lastSynced={preferences.lastDriveSync} />}{statsOpen && <StatsDialog ledger={ledger} accounts={accounts} onClose={() => setStatsOpen(false)} onEdit={record => { setStatsOpen(false); setEditing(record); }} onSync={() => { setStatsOpen(false); setSyncOpen(true); }} />}{editing && <EditDialog record={editing} accounts={accounts} onClose={() => setEditing(null)} onSave={saveEditedTransaction} />}
    {notice && <div className="toast" onAnimationEnd={() => setNotice('')}>{notice}</div>}
  </main></>;
}
