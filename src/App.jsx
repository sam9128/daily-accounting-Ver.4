import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { all, initializeDatabase, put, putMany, settingsObject } from './lib/db.js';
import { calculate, categories, defaultAccounts, expenseCategories, investmentCategories, num } from './lib/ledger.js';
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
    <label className="wide category-field">分類項目<select name="category" value={form.category} onChange={change}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
    <div className="quick-categories"><span>分類項目</span><div>{categories.map(category => <button type="button" className={form.category === category ? 'active' : ''} key={category} onClick={() => setForm(current => ({ ...current, category }))}>{category}</button>)}</div></div>
    <label className="wide reason-field">原因<input name="reason" value={form.reason} onChange={change} placeholder="原因備註" /></label>
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

const chartColors = ['#d96b64', '#c07a49', '#c9a64a', '#6e9d68', '#4f9198', '#5f79a8', '#8163a8', '#98658f', '#777b80'];
const investmentColors = ['#7186a8', '#9a7c63', '#708f82'];

const longPressDuration = 550;

function FlowRow({ record, onEdit, variant = 'card', details }) {
  const timer = useRef(null);
  const pointerOrigin = useRef(null);
  const [pressing, setPressing] = useState(false);
  const cancelLongPress = () => {
    clearTimeout(timer.current);
    timer.current = null;
    pointerOrigin.current = null;
    setPressing(false);
  };
  const startLongPress = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    clearTimeout(timer.current);
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    setPressing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      pointerOrigin.current = null;
      setPressing(false);
      navigator.vibrate?.(18);
      onEdit(record);
    }, longPressDuration);
  };
  const trackPointer = event => {
    if (!pointerOrigin.current) return;
    const moved = Math.hypot(event.clientX - pointerOrigin.current.x, event.clientY - pointerOrigin.current.y);
    if (moved > 10) cancelLongPress();
  };
  const editFromKeyboard = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onEdit(record);
  };
  const className = `${variant === 'ledger' ? 'desktop-flow-record' : 'flow-row'}${pressing ? ' pressing' : ''}`;
  return <button
    className={className}
    aria-label={`${record.date} ${record.category} ${record.reason || '未註記'}，長按修改`}
    onClick={event => event.preventDefault()}
    onContextMenu={event => event.preventDefault()}
    onKeyDown={editFromKeyboard}
    onPointerDown={startLongPress}
    onPointerMove={trackPointer}
    onPointerUp={cancelLongPress}
    onPointerCancel={cancelLongPress}
    onPointerLeave={cancelLongPress}
  >
    {variant === 'ledger' ? <>
      <span>{record.date}</span><span>{record.account}</span><span>{record.category}</span><span className="ledger-reason">{record.reason || '未註記'}</span><b className="out">{record.expense ? `−${plainMoney(record.expense)}` : '0'}</b><b className="in">{record.income ? `＋${plainMoney(record.income)}` : '0'}</b><b>{plainMoney(details?.accountBalance || 0)}</b><b>{plainMoney(details?.runningTotal || 0)}</b>
    </> : <>
      <span className="flow-copy"><small>{record.date} · {record.category}</small><b>{record.reason || '未註記'}</b><em>{record.account}</em></span>
      <span className="flow-amounts"><small className="out">支出 <b>{record.expense ? `−${plainMoney(record.expense)}` : '0'}</b></small><small className="in">收入 <b>{record.income ? `＋${plainMoney(record.income)}` : '0'}</b></small></span>
    </>}
  </button>;
}

function FlowRows({ records, onEdit, showHint = true }) {
  if (!records.length) return <div className="empty-state">目前沒有符合條件的流水。</div>;
  return <>{showHint && <div className="flow-edit-hint">長按一筆流水即可修改</div>}<div className="flow-rows">{records.map(record => <FlowRow record={record} onEdit={onEdit} key={record.id} />)}</div></>;
}

function LedgerTotals({ ledger, onOpen }) {
  const items = [...investmentCategories, '轉'];
  return items.map(item => <button className="ledger-total" type="button" onClick={onOpen} key={item}><span>{item}</span><b className={ledger.categoryTotals[item] < 0 ? 'negative' : ''}>{plainMoney(ledger.categoryTotals[item])}</b></button>);
}

function DesktopFlowLedger({ records, rowDetails, onEdit }) {
  if (!records.length) return <div className="desktop-flow-ledger"><div className="empty-state">目前沒有符合條件的流水。</div></div>;
  return <div className="desktop-flow-ledger"><div className="desktop-flow-head"><span>日期</span><span>帳戶</span><span>分類</span><span>原因</span><span>支出</span><span>收入</span><span>帳戶餘額</span><span>總額</span></div><div>{records.map(record => <FlowRow record={record} details={rowDetails[record.id]} onEdit={onEdit} variant="ledger" key={record.id} />)}</div></div>;
}

function StatsDialog({ ledger, accounts, onClose, onEdit, onSync }) {
  const [mode, setMode] = useState('month');
  const [account, setAccount] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState('');
  const [cursorDate, setCursorDate] = useState(today);
  const periodLedger = useMemo(() => calculate(ledger.rows, accounts, cursorDate), [ledger.rows, accounts, cursorDate]);
  const stats = mode === 'year' ? periodLedger.year : periodLedger.month;
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-TW');
    return ledger.rows.slice().reverse().filter(record => {
      const matchesFilters = (account === 'all' || record.account === account) && (category === 'all' || record.category === category);
      if (!matchesFilters || !normalizedQuery) return matchesFilters;
      const details = ledger.rowDetails[record.id];
      return [record.date, record.category, record.reason || '未註記', record.account, record.expense, record.income, details?.accountBalance, details?.runningTotal]
        .some(value => String(value ?? '').toLocaleLowerCase('zh-TW').includes(normalizedQuery));
    });
  }, [ledger.rows, account, category, query]);
  const visibleTotals = useMemo(() => visible.reduce((totals, record) => ({
    expense: totals.expense + num(record.expense),
    income: totals.income + num(record.income),
  }), { expense: 0, income: 0 }), [visible]);
  const periodRows = useMemo(() => {
    const target = new Date(`${cursorDate}T12:00:00`);
    return ledger.rows.slice().reverse().filter(record => {
      const recordDate = new Date(`${record.date}T12:00:00`);
      return recordDate.getFullYear() === target.getFullYear()
        && (mode === 'year' || recordDate.getMonth() === target.getMonth());
    });
  }, [ledger.rows, cursorDate, mode]);
  const amounts = expenseCategories.map(item => Math.abs(stats.values[item]));
  const totalSpent = amounts.reduce((sum, value) => sum + value, 0);
  let angle = 0;
  const chart = amounts.map((value, index) => {
    const start = angle;
    angle += totalSpent ? value / totalSpent * 360 : 0;
    return `${chartColors[index]} ${start}deg ${angle}deg`;
  }).join(', ');
  const movePeriod = direction => {
    const date = new Date(`${cursorDate}T12:00:00`);
    if (mode === 'year') date.setFullYear(date.getFullYear() + direction);
    else date.setMonth(date.getMonth() + direction);
    setCursorDate(date.toLocaleDateString('sv-SE'));
    setExpandedCategory('');
  };
  const selectedDate = new Date(`${cursorDate}T12:00:00`);
  const periodLabel = mode === 'year' ? `${selectedDate.getFullYear()} 年` : `${selectedDate.getFullYear()} 年 ${selectedDate.getMonth() + 1} 月`;
  const previousPeriodLabel = mode === 'year' ? '上一年' : '上一月';
  const nextPeriodLabel = mode === 'year' ? '下一年' : '下一月';
  const selectMode = nextMode => { setMode(nextMode); setExpandedCategory(''); };
  return <dialog open className="stats-dialog" aria-labelledby="stats-title">
    <header className="stats-header"><button className="stats-close" onClick={onClose} aria-label="關閉"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button><h2 id="stats-title">統計與流水</h2><div className="mode-tabs"><button className={mode === 'month' ? 'active' : ''} onClick={() => selectMode('month')}>月</button><button className={mode === 'year' ? 'active' : ''} onClick={() => selectMode('year')}>年</button><button className={mode === 'all' ? 'active' : ''} onClick={() => selectMode('all')}>流水</button></div><button className="stats-sync" onClick={onSync}>資料與同步</button></header>
    {mode !== 'all' ? <><div className="period-pager"><button onClick={() => movePeriod(-1)}>{previousPeriodLabel}</button><strong>{periodLabel}</strong><button onClick={() => movePeriod(1)}>{nextPeriodLabel}</button></div><section className="stats-content"><div className="stats-overview"><div className="donut" style={{ background: totalSpent ? `conic-gradient(${chart})` : '#292929' }}><div><span>支出</span><strong>{plainMoney(totalSpent)}</strong></div></div><div className="stat-summaries"><article><span>差額</span><strong>{plainMoney(stats.diff)}</strong></article><article><span>儲蓄</span><strong>{plainMoney(stats.save)}</strong></article></div></div><div className="stat-list">{expenseCategories.map((item, index) => <div className="stat-entry" key={item}><button className="stat-row" aria-expanded={expandedCategory === item} onClick={() => setExpandedCategory(current => current === item ? '' : item)}><i style={{ backgroundColor: chartColors[index] }}></i><span>{item}</span><b>{plainMoney(Math.abs(stats.values[item]))}</b><small>{totalSpent ? `${(Math.abs(stats.values[item]) / totalSpent * 100).toFixed(1)}%` : '0.0%'}</small></button>{expandedCategory === item && <div className="category-details"><FlowRows records={periodRows.filter(record => record.category === item)} onEdit={onEdit} showHint={false} /></div>}</div>)}</div><section className="investment-stats"><h3>帳目項目 <small>投資淨額 {plainMoney(stats.investmentTotal)} · 轉帳 {plainMoney(stats.transferTotal)}</small></h3>{investmentCategories.map((item, index) => <div className="stat-entry" key={item}><button className="stat-row" aria-expanded={expandedCategory === item} onClick={() => setExpandedCategory(current => current === item ? '' : item)}><i style={{ backgroundColor: investmentColors[index] }}></i><span>{item}</span><b>{plainMoney(stats.investments[item])}</b><small>投資</small></button>{expandedCategory === item && <div className="category-details"><FlowRows records={periodRows.filter(record => record.category === item)} onEdit={onEdit} showHint={false} /></div>}</div>)}<div className="stat-entry"><button className="stat-row" aria-expanded={expandedCategory === '轉'} onClick={() => setExpandedCategory(current => current === '轉' ? '' : '轉')}><i className="transfer-color"></i><span>轉</span><b>{plainMoney(stats.transferTotal)}</b><small>轉帳</small></button>{expandedCategory === '轉' && <div className="category-details"><FlowRows records={periodRows.filter(record => record.category === '轉')} onEdit={onEdit} showHint={false} /></div>}</div></section></section></> : <section className="logs"><div className="filters"><input className="log-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="查詢流水" aria-label="查詢流水" /><select value={account} onChange={event => setAccount(event.target.value)}><option value="all">所有帳戶</option>{accounts.map(item => <option key={item}>{item}</option>)}</select><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">所有分類</option>{categories.map(item => <option key={item}>{item}</option>)}</select></div><div className="flow-query-summary"><span><small>符合</small><b>{visible.length} 筆</b></span><span><small>支出</small><b className="out">−{plainMoney(visibleTotals.expense)}</b></span><span><small>收入</small><b className="in">＋{plainMoney(visibleTotals.income)}</b></span><span><small>淨額</small><b>{plainMoney(visibleTotals.income - visibleTotals.expense)}</b></span></div><div className="flow-edit-hint desktop-flow-hint">長按一筆流水即可修改</div><DesktopFlowLedger records={visible} rowDetails={ledger.rowDetails} onEdit={onEdit} /><div className="mobile-flow-records"><FlowRows records={visible} onEdit={onEdit} /></div></section>}
  </dialog>;
}

function EditDialog({ record, accounts, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({ ...record, expense: record.expense || '', income: record.income || '' }));
  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = event => { event.preventDefault(); onSave({ ...form, expense: num(form.expense), income: num(form.income) }); };
  const confirmDelete = () => {
    if (window.confirm('確定要刪除這筆流水嗎？刪除結果會同步到其他裝置。')) onDelete(record);
  };
  return <dialog open className="edit-dialog" aria-labelledby="edit-title"><button className="close" onClick={onClose} aria-label="關閉">×</button><h2 id="edit-title">修改流水</h2><form onSubmit={submit}><input name="date" type="date" value={form.date} onChange={change}/><select name="account" value={form.account} onChange={change}>{accounts.map(item => <option key={item}>{item}</option>)}</select><select name="category" value={form.category} onChange={change}>{categories.map(item => <option key={item}>{item}</option>)}</select><input name="reason" value={form.reason} onChange={change} placeholder="原因備註"/><input name="expense" type="number" value={form.expense} onChange={change} placeholder="支出"/><input name="income" type="number" value={form.income} onChange={change} placeholder="收入"/><div className="edit-actions"><button className="danger" type="button" onClick={confirmDelete}>刪除這筆流水</button><button className="primary">儲存修改</button></div></form></dialog>;
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

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    let largestHeight = viewport.height;
    let delayedTimer;
    const updateKeyboardLayout = () => {
      const editableFocused = document.activeElement?.matches('input, textarea, select');
      if (editableFocused) largestHeight = Math.max(largestHeight, viewport.height);
      else largestHeight = viewport.height;
      const keyboardOpen = editableFocused && largestHeight - viewport.height > 120;
      document.documentElement.classList.toggle('keyboard-open', keyboardOpen);
      document.documentElement.style.setProperty('--visual-offset-top', `${viewport.offsetTop}px`);
      document.documentElement.style.setProperty('--visual-height', `${viewport.height}px`);
    };
    const delayedUpdate = () => {
      clearTimeout(delayedTimer);
      delayedTimer = setTimeout(updateKeyboardLayout, 60);
    };
    updateKeyboardLayout();
    viewport.addEventListener('resize', updateKeyboardLayout);
    viewport.addEventListener('scroll', updateKeyboardLayout);
    window.addEventListener('focusin', delayedUpdate);
    window.addEventListener('focusout', delayedUpdate);
    return () => {
      viewport.removeEventListener('resize', updateKeyboardLayout);
      viewport.removeEventListener('scroll', updateKeyboardLayout);
      window.removeEventListener('focusin', delayedUpdate);
      window.removeEventListener('focusout', delayedUpdate);
      clearTimeout(delayedTimer);
      document.documentElement.classList.remove('keyboard-open');
    };
  }, []);

  const addTransaction = async values => {
    if (!num(values.expense) && !num(values.income)) { setNotice('請填入支出或收入。'); return false; }
    const record = { id: crypto.randomUUID(), sequence: Math.max(0, ...transactions.map(item => item.sequence || 0)) + 1, ...values, expense: num(values.expense), income: num(values.income), updatedAt: new Date().toISOString(), revision: 1, deleted: false };
    await put('transactions', record);
    setTransactions(current => [...current, record]);
    const next = { ...preferences, lastAccount: values.account, lastCategory: values.category };
    setPreferences(next); savePreferences(next);
    setNotice('已儲存到這台裝置。');
    setMobileView('add');
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

  const deleteTransaction = async record => {
    const tombstone = { ...record, deleted: true, updatedAt: new Date().toISOString(), revision: (record.revision || 0) + 1 };
    await put('transactions', tombstone);
    setTransactions(current => current.map(item => item.id === tombstone.id ? tombstone : item));
    setEditing(null);
    setNotice('流水已刪除，變更會在下次同步時套用到其他裝置。');
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

  return <main className={`view-${mobileView}`}>
    {update && <div className="update">已有新版可用。<button onClick={() => location.reload()}>立即更新</button></div>}
    <section className="summary"><button className="total-card" onClick={() => setStatsOpen(true)}><span>總計餘額 <i>›</i></span><strong><span className="desktop-value">{plainMoney(ledger.total)}</span><span className="mobile-value">{plainMoney(ledger.total)}</span></strong><small><span className="desktop-value"><b>日支出</b> {plainMoney(Math.abs(ledger.day.total))}<br /><b className="positive">月收入</b> {plainMoney(ledger.month.save)}</span><span className="mobile-value"><span className="daily"><b>日支出</b>{plainMoney(ledger.day.total)}</span><span className="monthly"><b>月收入</b>{plainMoney(ledger.month.save)}</span></span></small></button><article className="accounts"><h2>帳戶餘額</h2><div>{accounts.map(account => <button className={selectedAccount === account ? 'selected' : ''} key={account} onClick={() => { setSelectedAccount(account); setMobileView('add'); }}><span>{account}</span><b className={ledger.balances[account] < 0 ? 'negative' : ''}><span className="desktop-value">{plainMoney(ledger.balances[account])}</span><span className="mobile-value">{plainMoney(ledger.balances[account])}</span></b></button>)}<LedgerTotals ledger={ledger} onOpen={() => setStatsOpen(true)} /></div></article></section>
    <section className="workspace grid"><QuickTransactionForm accounts={accounts} preferences={preferences} selectedAccount={selectedAccount} onSave={addTransaction} /><section id="transactions" className="recent-flow"><div className="section-heading"><div><h2>近期交易</h2><small>顯示 {Math.min(16, ledger.rows.length)}／共 {ledger.rows.length} 筆</small></div><button onClick={() => setStatsOpen(true)}>查看全部流水</button></div><FlowRows records={ledger.rows.slice(-16).reverse()} onEdit={record => setEditing(record)} /></section></section>
    <nav className="mobile-nav" aria-label="手機導覽"><button className={mobileView === 'overview' ? 'active' : ''} onClick={() => setMobileView('overview')}>總覽</button><button className={mobileView === 'add' ? 'active' : ''} onClick={() => setMobileView('add')}>新增</button><button className={mobileView === 'transactions' ? 'active' : ''} onClick={() => setMobileView('transactions')}>交易</button><button onClick={() => setSyncOpen(true)}>同步</button></nav>
    {syncOpen && <SyncDialog isEmpty={transactions.length === 0} onClose={() => setSyncOpen(false)} onBackup={() => downloadJson(backupPayload())} onRestoreFile={restoreLocalBackup} onSync={syncDrive} syncing={syncing} lastSynced={preferences.lastDriveSync} />}{statsOpen && <StatsDialog ledger={ledger} accounts={accounts} onClose={() => setStatsOpen(false)} onEdit={record => setEditing(record)} onSync={() => { setStatsOpen(false); setSyncOpen(true); }} />}{editing && <EditDialog record={editing} accounts={accounts} onClose={() => setEditing(null)} onSave={saveEditedTransaction} onDelete={deleteTransaction} />}
    {notice && <div className="toast" onAnimationEnd={() => setNotice('')}>{notice}</div>}
  </main>;
}
