import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SettingsDialog, { GearIcon } from './components/SettingsDialog.jsx';
import { all, initializeDatabase, put, putMany, settingsObject } from './lib/db.js';
import { alignTransactionsToCatalog, catalogFromBackup, catalogUsage, cleanCatalogName, mergeCatalog, normalizeCatalog, renameTransactionReferences, sameCatalogName } from './lib/catalog.js';
import { calculate, defaultAccounts, num } from './lib/ledger.js';
import { connectDrive, downloadBackup, hasFreshDriveToken, mergeTransactions, prepareDrive, uploadBackup } from './lib/drive.js';
import { loadPreferences, savePreferences } from './lib/preferences.js';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const money = value => new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', maximumFractionDigits: 0 }).format(value);
const plainMoney = value => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(value);
const today = () => new Date().toLocaleDateString('sv-SE');
const blankForm = (preferences, accounts, categories) => ({ date: today(), account: accounts.includes(preferences.lastAccount) ? preferences.lastAccount : accounts[0], category: categories.includes(preferences.lastCategory) ? preferences.lastCategory : categories[0], reason: '', expense: '', income: '' });

function downloadJson(payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `daily-book-ver4-${today()}.json` });
  link.click();
  URL.revokeObjectURL(url);
}

function QuickTransactionForm({ accounts, categories, preferences, selectedAccount, onAccountChange, onSave }) {
  const [form, setForm] = useState(() => blankForm(preferences, accounts, categories));
  useEffect(() => setForm(current => ({ ...current, account: accounts.includes(current.account) ? current.account : accounts[0] })), [accounts]);
  useEffect(() => setForm(current => ({ ...current, category: categories.includes(current.category) ? current.category : categories[0] })), [categories]);
  useEffect(() => { if (selectedAccount) setForm(current => ({ ...current, account: selectedAccount })); }, [selectedAccount]);
  const change = event => {
    const { name, value } = event.target;
    setForm(current => ({ ...current, [name]: value }));
    if (name === 'account') onAccountChange(value);
  };
  const submit = async event => {
    event.preventDefault();
    const saved = await onSave(form);
    if (saved) setForm(current => ({ ...blankForm({ ...preferences, lastAccount: current.account, lastCategory: current.category }, accounts, categories), account: current.account, category: current.category }));
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

function LedgerTotals({ ledger, categoryDefinitions, onOpen }) {
  const items = categoryDefinitions.filter(item => !item.hidden && (item.investment || item.systemRole === 'transfer')).map(item => item.name);
  return items.map(item => <button className="ledger-total" type="button" onClick={onOpen} key={item}><span>{item}</span><b className={ledger.categoryTotals[item] < 0 ? 'negative' : ''}>{plainMoney(ledger.categoryTotals[item])}</b></button>);
}

function DesktopFlowLedger({ records, rowDetails, onEdit }) {
  if (!records.length) return <div className="desktop-flow-ledger"><div className="empty-state">目前沒有符合條件的流水。</div></div>;
  return <div className="desktop-flow-ledger"><div className="desktop-flow-head"><span>日期</span><span>帳戶</span><span>分類</span><span>原因</span><span>支出</span><span>收入</span><span>帳戶餘額</span><span>總額</span></div><div>{records.map(record => <FlowRow record={record} details={rowDetails[record.id]} onEdit={onEdit} variant="ledger" key={record.id} />)}</div></div>;
}

function StatsDialog({ ledger, accounts, categoryDefinitions, onClose, onEdit, onSettings }) {
  const [mode, setMode] = useState('month');
  const [account, setAccount] = useState('all');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState('');
  const [cursorDate, setCursorDate] = useState(today);
  const categories = categoryDefinitions.map(item => item.name);
  const expenseCategories = categoryDefinitions.filter(item => !item.investment && !item.systemRole).map(item => item.name);
  const investmentCategories = categoryDefinitions.filter(item => item.investment).map(item => item.name);
  const hiddenCategories = new Set(categoryDefinitions.filter(item => item.hidden).map(item => item.name));
  const periodLedger = useMemo(() => calculate(ledger.rows, accounts, cursorDate, categoryDefinitions), [ledger.rows, accounts, cursorDate, categoryDefinitions]);
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
  const visibleExpenseCategories = expenseCategories.filter(item => !hiddenCategories.has(item) || Math.abs(stats.values[item]) > 0);
  const visibleInvestmentCategories = investmentCategories.filter(item => !hiddenCategories.has(item) || Math.abs(stats.investments[item]) > 0);
  const amounts = visibleExpenseCategories.map(item => Math.abs(stats.values[item]));
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
    <header className="stats-header"><button className="stats-close" onClick={onClose} aria-label="關閉"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button><h2 id="stats-title">統計與流水</h2><div className="mode-tabs"><button className={mode === 'month' ? 'active' : ''} onClick={() => selectMode('month')}>月</button><button className={mode === 'year' ? 'active' : ''} onClick={() => selectMode('year')}>年</button><button className={mode === 'all' ? 'active' : ''} onClick={() => selectMode('all')}>流水</button></div><button className="stats-settings" onClick={onSettings} aria-label="設定"><GearIcon /></button></header>
    {mode !== 'all' ? <><div className="period-pager"><button onClick={() => movePeriod(-1)}>{previousPeriodLabel}</button><strong>{periodLabel}</strong><button onClick={() => movePeriod(1)}>{nextPeriodLabel}</button></div><section className="stats-content"><div className="stats-overview"><div className="donut" style={{ background: totalSpent ? `conic-gradient(${chart})` : '#292929' }}><div><span>支出</span><strong>{plainMoney(totalSpent)}</strong></div></div><div className="stat-summaries"><article><span>差額</span><strong>{plainMoney(stats.diff)}</strong></article><article><span>儲蓄</span><strong>{plainMoney(stats.save)}</strong></article></div></div><div className="stat-list">{visibleExpenseCategories.map((item, index) => <div className="stat-entry" key={item}><button className="stat-row" aria-expanded={expandedCategory === item} onClick={() => setExpandedCategory(current => current === item ? '' : item)}><i style={{ backgroundColor: chartColors[index % chartColors.length] }}></i><span>{item}</span><b>{plainMoney(Math.abs(stats.values[item]))}</b><small>{totalSpent ? `${(Math.abs(stats.values[item]) / totalSpent * 100).toFixed(1)}%` : '0.0%'}</small></button>{expandedCategory === item && <div className="category-details"><FlowRows records={periodRows.filter(record => record.category === item)} onEdit={onEdit} showHint={false} /></div>}</div>)}</div><section className="investment-stats"><h3>帳目項目 <small>投資淨額 {plainMoney(stats.investmentTotal)} · 轉帳 {plainMoney(stats.transferTotal)}</small></h3>{visibleInvestmentCategories.map((item, index) => <div className="stat-entry" key={item}><button className="stat-row" aria-expanded={expandedCategory === item} onClick={() => setExpandedCategory(current => current === item ? '' : item)}><i style={{ backgroundColor: investmentColors[index % investmentColors.length] }}></i><span>{item}</span><b>{plainMoney(stats.investments[item])}</b><small>投資</small></button>{expandedCategory === item && <div className="category-details"><FlowRows records={periodRows.filter(record => record.category === item)} onEdit={onEdit} showHint={false} /></div>}</div>)}{categoryDefinitions.filter(item => item.systemRole === 'transfer' && (!item.hidden || Math.abs(stats.transferTotal) > 0)).map(item => <div className="stat-entry" key={item.id}><button className="stat-row" aria-expanded={expandedCategory === item.name} onClick={() => setExpandedCategory(current => current === item.name ? '' : item.name)}><i className="transfer-color"></i><span>{item.name}</span><b>{plainMoney(stats.transferTotal)}</b><small>轉帳</small></button>{expandedCategory === item.name && <div className="category-details"><FlowRows records={periodRows.filter(record => record.category === item.name)} onEdit={onEdit} showHint={false} /></div>}</div>)}</section></section></> : <section className="logs"><div className="filters"><input className="log-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="查詢流水" aria-label="查詢流水" /><select value={account} onChange={event => setAccount(event.target.value)}><option value="all">所有帳戶</option>{accounts.map(item => <option key={item}>{item}</option>)}</select><select value={category} onChange={event => setCategory(event.target.value)}><option value="all">所有分類</option>{categories.map(item => <option key={item}>{item}</option>)}</select></div><DesktopFlowLedger records={visible} rowDetails={ledger.rowDetails} onEdit={onEdit} /><div className="mobile-flow-records"><FlowRows records={visible} onEdit={onEdit} /></div></section>}
  </dialog>;
}

function EditDialog({ record, accounts, categories, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => ({ ...record, expense: record.expense || '', income: record.income || '' }));
  const change = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }));
  const submit = event => { event.preventDefault(); onSave({ ...form, expense: num(form.expense), income: num(form.income) }); };
  const confirmDelete = () => {
    if (window.confirm('確定要刪除這筆流水嗎？刪除結果會同步到其他裝置。')) onDelete(record);
  };
  const accountOptions = [...new Set([...accounts, record.account])];
  const categoryOptions = [...new Set([...categories, record.category])];
  return <dialog open className="edit-dialog" aria-labelledby="edit-title"><button className="close" onClick={onClose} aria-label="關閉">×</button><h2 id="edit-title">修改流水</h2><form onSubmit={submit}><input name="date" type="date" value={form.date} onChange={change}/><select name="account" value={form.account} onChange={change}>{accountOptions.map(item => <option key={item}>{item}</option>)}</select><select name="category" value={form.category} onChange={change}>{categoryOptions.map(item => <option key={item}>{item}</option>)}</select><input name="reason" value={form.reason} onChange={change} placeholder="原因備註"/><input name="expense" type="number" value={form.expense} onChange={change} placeholder="支出"/><input name="income" type="number" value={form.income} onChange={change} placeholder="收入"/><div className="edit-actions"><button className="danger" type="button" onClick={confirmDelete}>刪除這筆流水</button><button className="primary">儲存修改</button></div></form></dialog>;
}

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [settings, setSettings] = useState({});
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseError, setDatabaseError] = useState('');
  const [preferences, setPreferences] = useState(loadPreferences);
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [backgroundSyncState, setBackgroundSyncState] = useState('idle');
  const [update, setUpdate] = useState(false);
  const [mobileView, setMobileView] = useState('add');
  const [selectedAccount, setSelectedAccount] = useState(defaultAccounts[0]);
  const [statsOpen, setStatsOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const accountRailRef = useRef(null);
  const driveSyncQueueRef = useRef(Promise.resolve());
  const backgroundSyncInFlightRef = useRef(null);
  const backgroundLoadAttemptedRef = useRef(false);
  const catalog = useMemo(() => normalizeCatalog(settings.catalog, { accounts: settings.accounts, categories: settings.categories }), [settings.catalog, settings.accounts, settings.categories]);
  const accounts = catalog.accounts.filter(item => !item.hidden).map(item => item.name);
  const allAccounts = catalog.accounts.map(item => item.name);
  const categoryDefinitions = catalog.categories;
  const categories = categoryDefinitions.filter(item => !item.hidden).map(item => item.name);
  const allCategories = categoryDefinitions.map(item => item.name);
  const ledger = useMemo(() => calculate(transactions, allAccounts, undefined, categoryDefinitions), [transactions, allAccounts.join('\u0000'), categoryDefinitions]);
  const accountUsage = useMemo(() => Object.fromEntries(catalog.accounts.map(item => [item.name, catalogUsage(transactions, 'account', item.name, item.aliases)])), [transactions, catalog.accounts]);
  const categoryUsage = useMemo(() => Object.fromEntries(catalog.categories.map(item => [item.name, catalogUsage(transactions, 'category', item.name, item.aliases)])), [transactions, catalog.categories]);
  const persistCatalog = useCallback(async value => { await put('settings', { key: 'catalog', value }); setSettings(current => ({ ...current, catalog: value })); }, []);
  const persistTransactions = useCallback(async records => { await putMany('transactions', records); setTransactions(records); }, []);

  useEffect(() => {
    const rail = accountRailRef.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth) return;
    rail.querySelector('.selected')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedAccount]);

  useEffect(() => {
    if (!accounts.includes(selectedAccount)) setSelectedAccount(accounts[0]);
  }, [accounts.join('\u0000'), selectedAccount]);

  useEffect(() => {
    let active = true;
    initializeDatabase()
      .then(() => Promise.all([all('transactions'), all('settings')]))
      .then(([records, saved]) => {
        if (!active) return;
        setTransactions(records);
        setSettings(settingsObject(saved));
        setDatabaseReady(true);
        if (records.length === 0) setSettingsOpen(true);
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
    if (CLIENT_ID) prepareDrive().catch(() => {});
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

  const catalogNameExists = (items, name, exceptId) => items.some(item => item.id !== exceptId && sameCatalogName(item.name, name));
  const nextCatalogId = type => `${type}-${crypto.randomUUID()}`;

  const addAccount = async name => {
    const value = cleanCatalogName(name);
    if (!value) { setNotice('請輸入帳戶名稱。'); return false; }
    if (catalogNameExists(catalog.accounts, value)) { setNotice('已有相同名稱的帳戶。'); return false; }
    const next = { ...catalog, updatedAt: new Date().toISOString(), accounts: [...catalog.accounts, { id: nextCatalogId('account'), name: value, aliases: [], hidden: false }] };
    await persistCatalog(next);
    setNotice(`已新增帳戶「${value}」。`);
    return true;
  };

  const renameAccount = async (id, name) => {
    const value = cleanCatalogName(name);
    const current = catalog.accounts.find(item => item.id === id);
    if (!current || !value) { setNotice('請輸入帳戶名稱。'); return false; }
    if (catalogNameExists(catalog.accounts, value, id)) { setNotice('已有相同名稱的帳戶。'); return false; }
    if (current.name === value) return true;
    const timestamp = new Date().toISOString();
    const migrated = renameTransactionReferences(transactions, 'account', current.name, value, timestamp);
    const next = { ...catalog, updatedAt: timestamp, accounts: catalog.accounts.map(item => item.id === id ? { ...item, name: value, aliases: [...new Set([...(item.aliases || []), current.name])] } : item) };
    await persistTransactions(migrated);
    await persistCatalog(next);
    if (selectedAccount === current.name) setSelectedAccount(value);
    const nextPreferences = { ...preferences, lastAccount: preferences.lastAccount === current.name ? value : preferences.lastAccount };
    setPreferences(nextPreferences); savePreferences(nextPreferences);
    setNotice(`帳戶已改名為「${value}」，相關流水已同步更新。`);
    return true;
  };

  const setAccountHidden = async (id, hidden) => {
    const current = catalog.accounts.find(item => item.id === id);
    if (!current) return false;
    if (hidden && catalog.accounts.filter(item => !item.hidden).length <= 1) { setNotice('至少要保留一個可用帳戶。'); return false; }
    const usage = accountUsage[current.name] || 0;
    if (hidden && !window.confirm(`隱藏帳戶「${current.name}」？${usage ? `\n${usage} 筆歷史流水會保留，仍可在流水查詢與有數據的統計中查看。` : ''}\n之後可在設定中重新開啟。`)) return false;
    const next = { ...catalog, updatedAt: new Date().toISOString(), accounts: catalog.accounts.map(item => item.id === id ? { ...item, hidden } : item) };
    await persistCatalog(next);
    setNotice(hidden ? `已隱藏帳戶「${current.name}」。` : `已重新開啟帳戶「${current.name}」。`);
    return true;
  };

  const deleteAccount = async id => {
    const current = catalog.accounts.find(item => item.id === id);
    if (!current?.hidden) { setNotice('請先隱藏帳戶，再進行永久刪除。'); return false; }
    const usage = catalogUsage(transactions, 'account', current.name, current.aliases);
    if (usage) { setNotice(`帳戶「${current.name}」仍影響 ${usage} 筆流水，無法刪除。`); return false; }
    if (!window.confirm(`永久刪除帳戶「${current.name}」？\n此動作無法復原。`)) return false;
    const next = { ...catalog, updatedAt: new Date().toISOString(), accounts: catalog.accounts.filter(item => item.id !== id) };
    await persistCatalog(next);
    const fallback = next.accounts.find(item => !item.hidden)?.name;
    const nextPreferences = { ...preferences, lastAccount: preferences.lastAccount === current.name ? fallback : preferences.lastAccount };
    setPreferences(nextPreferences); savePreferences(nextPreferences);
    setNotice(`已永久刪除未被流水使用的帳戶「${current.name}」。`);
    return true;
  };

  const addCategory = async (name, investment) => {
    const value = cleanCatalogName(name);
    if (!value) { setNotice('請輸入分類名稱。'); return false; }
    if (catalogNameExists(catalog.categories, value)) { setNotice('已有相同名稱的分類。'); return false; }
    const next = { ...catalog, updatedAt: new Date().toISOString(), categories: [...catalog.categories, { id: nextCatalogId('category'), name: value, aliases: [], investment: Boolean(investment), systemRole: null, hidden: false }] };
    await persistCatalog(next);
    setNotice(`已新增${investment ? '投資' : '一般'}分類「${value}」。`);
    return true;
  };

  const updateCategory = async (id, name, investment) => {
    const value = cleanCatalogName(name);
    const current = catalog.categories.find(item => item.id === id);
    if (!current || !value) { setNotice('請輸入分類名稱。'); return false; }
    if (catalogNameExists(catalog.categories, value, id)) { setNotice('已有相同名稱的分類。'); return false; }
    const renamed = current.name !== value;
    const investmentChanged = current.investment !== Boolean(investment);
    if (!renamed && !investmentChanged) return true;
    const timestamp = new Date().toISOString();
    const migrated = renamed ? renameTransactionReferences(transactions, 'category', current.name, value, timestamp) : transactions;
    const next = { ...catalog, updatedAt: timestamp, categories: catalog.categories.map(item => item.id === id ? { ...item, name: value, investment: Boolean(investment), aliases: renamed ? [...new Set([...(item.aliases || []), current.name])] : item.aliases } : item) };
    if (renamed) await persistTransactions(migrated);
    await persistCatalog(next);
    if (renamed) {
      const nextPreferences = { ...preferences, lastCategory: preferences.lastCategory === current.name ? value : preferences.lastCategory };
      setPreferences(nextPreferences); savePreferences(nextPreferences);
    }
    setNotice(renamed
      ? `分類已更新為「${value}」${investmentChanged ? `，並設為${investment ? '投資項目' : '一般分類'}` : ''}。`
      : `「${value}」已設為${investment ? '投資項目' : '一般分類'}。`);
    return true;
  };

  const setCategoryHidden = async (id, hidden) => {
    const current = catalog.categories.find(item => item.id === id);
    if (!current) return false;
    if (hidden && catalog.categories.filter(item => !item.hidden).length <= 1) { setNotice('至少要保留一個可用分類。'); return false; }
    const usage = categoryUsage[current.name] || 0;
    if (hidden && !window.confirm(`隱藏分類「${current.name}」？${usage ? `\n${usage} 筆歷史流水會保留；當期有數據時仍會出現在統計中。` : ''}\n之後可在設定中重新開啟。`)) return false;
    const next = { ...catalog, updatedAt: new Date().toISOString(), categories: catalog.categories.map(item => item.id === id ? { ...item, hidden } : item) };
    await persistCatalog(next);
    setNotice(hidden ? `已隱藏分類「${current.name}」。` : `已重新開啟分類「${current.name}」。`);
    return true;
  };

  const deleteCategory = async id => {
    const current = catalog.categories.find(item => item.id === id);
    if (!current?.hidden) { setNotice('請先隱藏分類，再進行永久刪除。'); return false; }
    const usage = catalogUsage(transactions, 'category', current.name, current.aliases);
    if (usage) { setNotice(`分類「${current.name}」仍影響 ${usage} 筆流水，無法刪除。`); return false; }
    if (!window.confirm(`永久刪除分類「${current.name}」？\n此動作無法復原。`)) return false;
    const next = { ...catalog, updatedAt: new Date().toISOString(), categories: catalog.categories.filter(item => item.id !== id) };
    await persistCatalog(next);
    const fallback = next.categories.find(item => !item.hidden)?.name;
    const nextPreferences = { ...preferences, lastCategory: preferences.lastCategory === current.name ? fallback : preferences.lastCategory };
    setPreferences(nextPreferences); savePreferences(nextPreferences);
    setNotice(`已永久刪除未被流水使用的分類「${current.name}」。`);
    return true;
  };

  const addTransaction = async values => {
    if (!num(values.expense) && !num(values.income)) { setNotice('請填入支出或收入。'); return false; }
    const automaticAuthorization = preferences.autoDriveSync && CLIENT_ID
      ? connectDrive(CLIENT_ID, { interactive: false }).then(() => null, error => error)
      : null;
    const record = { id: crypto.randomUUID(), sequence: Math.max(0, ...transactions.map(item => item.sequence || 0)) + 1, ...values, expense: num(values.expense), income: num(values.income), updatedAt: new Date().toISOString(), revision: 1, deleted: false };
    await put('transactions', record);
    const localRecords = [...transactions, record];
    setTransactions(localRecords);
    const next = { ...preferences, lastAccount: values.account, lastCategory: values.category };
    setPreferences(next); savePreferences(next);
    setNotice(automaticAuthorization ? '已儲存到這台裝置，正在同步…' : '已儲存到這台裝置。');
    setMobileView('add');
    if (automaticAuthorization) {
      void automaticAuthorization.then(error => {
        if (error) {
          setBackgroundSyncState('waiting-auth');
          setNotice(`已保存在本機；${error.message || 'Google 登入未完成。'}`);
          return;
        }
        setBackgroundSyncState('syncing');
        setSyncing(true);
        const task = driveSyncQueueRef.current.catch(() => {}).then(() => synchronizeDriveData(localRecords));
        driveSyncQueueRef.current = task;
        void task
          .then(result => { setBackgroundSyncState('synced'); setNotice(`已自動同步 ${result.merged.length} 筆資料到 Drive。`); })
          .catch(syncError => { setBackgroundSyncState('error'); setNotice(`已保存在本機；${syncError.message || 'Drive 自動同步未完成。'}`); })
          .finally(() => setSyncing(false));
      });
    }
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

  const backupPayload = () => ({ schema: 6, catalog, accounts: allAccounts, categories: categoryDefinitions, transactions, catalogUpdatedAt: catalog.updatedAt, exportedAt: new Date().toISOString() });
  const restoreLocalBackup = async file => {
    try {
      const payload = JSON.parse(await file.text());
      if (![4, 5, 6].includes(payload?.schema) || !Array.isArray(payload.transactions) || payload.transactions.length === 0) throw new Error('本機備份格式不相容或沒有交易資料。');
      if (payload.transactions.some(record => !record?.id || !record?.date || !record?.account || !record?.category)) throw new Error('本機備份缺少必要的交易欄位。');
      const restored = mergeTransactions(transactions, payload.transactions);
      const restoredCatalog = mergeCatalog(catalog, catalogFromBackup(payload, restored));
      const aligned = alignTransactionsToCatalog(restored, restoredCatalog);
      await persistTransactions(aligned);
      await persistCatalog(restoredCatalog);
      setNotice(`已從本機私密備份還原 ${restored.length} 筆資料。`);
      setSettingsOpen(false);
    } catch (error) {
      setNotice(error.message || '無法讀取本機私密備份。');
    }
  };
  const synchronizeDriveData = async localTransactions => {
    const remote = await downloadBackup();
    if (localTransactions.length === 0 && (!remote || remote.transactions.length === 0)) throw new Error('Google Drive 找不到可還原的帳本備份，請改用本機私密備份。');
    const merged = mergeTransactions(localTransactions, remote?.transactions || []);
    const syncedCatalog = mergeCatalog(catalog, remote ? catalogFromBackup(remote, merged) : null);
    const aligned = alignTransactionsToCatalog(merged, syncedCatalog);
    await persistTransactions(aligned);
    await persistCatalog(syncedCatalog);
    await uploadBackup({ schema: 6, catalog: syncedCatalog, accounts: syncedCatalog.accounts.map(item => item.name), categories: syncedCatalog.categories, transactions: aligned, catalogUpdatedAt: syncedCatalog.updatedAt, exportedAt: new Date().toISOString() });
    const next = { ...loadPreferences(), lastDriveSync: new Date().toISOString(), autoDriveSync: true };
    setPreferences(next); savePreferences(next);
    return { remote, merged };
  };
  const attemptBackgroundDriveSync = async () => {
    if (!CLIENT_ID || !preferences.autoDriveSync) return false;
    if (!navigator.onLine) {
      setBackgroundSyncState('offline');
      return false;
    }
    if (backgroundSyncInFlightRef.current) return backgroundSyncInFlightRef.current;
    setBackgroundSyncState('preparing');
    try {
      await prepareDrive();
      if (!hasFreshDriveToken()) {
        setBackgroundSyncState('waiting-auth');
        return false;
      }
      setBackgroundSyncState('syncing');
      setSyncing(true);
      const task = driveSyncQueueRef.current.catch(() => {}).then(() => synchronizeDriveData(transactions));
      driveSyncQueueRef.current = task;
      backgroundSyncInFlightRef.current = task;
      await task;
      setBackgroundSyncState('synced');
      return true;
    } catch {
      setBackgroundSyncState(navigator.onLine ? 'error' : 'offline');
      return false;
    } finally {
      backgroundSyncInFlightRef.current = null;
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!databaseReady || backgroundLoadAttemptedRef.current) return;
    backgroundLoadAttemptedRef.current = true;
    void attemptBackgroundDriveSync();
  }, [databaseReady]);

  useEffect(() => {
    if (!databaseReady || !preferences.autoDriveSync || !CLIENT_ID) return undefined;
    const retryWhenAvailable = () => {
      if (document.visibilityState === 'visible') void attemptBackgroundDriveSync();
    };
    window.addEventListener('online', retryWhenAvailable);
    document.addEventListener('visibilitychange', retryWhenAvailable);
    return () => {
      window.removeEventListener('online', retryWhenAvailable);
      document.removeEventListener('visibilitychange', retryWhenAvailable);
    };
  }, [databaseReady, preferences.autoDriveSync, transactions, catalog.updatedAt]);

  const syncDrive = async () => {
    setSyncing(true);
    setBackgroundSyncState('syncing');
    try {
      await driveSyncQueueRef.current.catch(() => {});
      await connectDrive(CLIENT_ID, { interactive: true });
      const result = await synchronizeDriveData(transactions);
      setBackgroundSyncState('synced');
      setNotice(result.remote ? `已合併 ${result.merged.length} 筆資料並同步到 Drive，之後送出交易會自動同步。` : '已在 Google Drive 建立第一份備份，之後送出交易會自動同步。');
      setSettingsOpen(false);
    } catch (error) { setBackgroundSyncState('error'); setNotice(error.message || '同步未完成，請稍後再試。'); }
    finally { setSyncing(false); }
  };

  if (!databaseReady) return <main className="database-state"><strong>正在載入本機帳本…</strong><span>IndexedDB 初始化中</span></main>;
  if (databaseError) return <main className="database-state error"><strong>無法開啟帳本</strong><span>{databaseError}</span><button className="primary" onClick={() => location.reload()}>重新載入</button></main>;

  return <main className={`view-${mobileView}`}>
    {update && <div className="update">已有新版可用。<button onClick={() => location.reload()}>立即更新</button></div>}
    <section className="summary"><button className="total-card" onClick={() => setStatsOpen(true)}><span>總計餘額 <i>›</i></span><strong><span className="desktop-value">{plainMoney(ledger.total)}</span><span className="mobile-value">{plainMoney(ledger.total)}</span></strong><small><span className="daily"><b>日支出</b><span>{plainMoney(ledger.day.total)}</span></span><span className="monthly"><b>月收入</b><span>{plainMoney(ledger.month.save)}</span></span></small></button><article className="accounts"><h2>帳戶餘額</h2><div ref={accountRailRef}>{accounts.map(account => <button className={selectedAccount === account ? 'selected' : ''} key={account} onClick={() => { setSelectedAccount(account); setMobileView('add'); }}><span>{account}</span><b className={ledger.balances[account] < 0 ? 'negative' : ''}><span className="desktop-value">{plainMoney(ledger.balances[account])}</span><span className="mobile-value">{plainMoney(ledger.balances[account])}</span></b></button>)}<LedgerTotals ledger={ledger} categoryDefinitions={categoryDefinitions} onOpen={() => setStatsOpen(true)} /></div></article></section>
    <section className="workspace grid"><QuickTransactionForm accounts={accounts} categories={categories} preferences={preferences} selectedAccount={selectedAccount} onAccountChange={setSelectedAccount} onSave={addTransaction} /><section id="transactions" className="recent-flow"><div className="section-heading"><div><h2>近期交易</h2><small>顯示 {Math.min(16, ledger.rows.length)}／共 {ledger.rows.length} 筆</small></div><button onClick={() => setStatsOpen(true)}>查看全部流水</button></div><FlowRows records={ledger.rows.slice(-16).reverse()} onEdit={record => setEditing(record)} /></section></section>
    <nav className="mobile-nav" aria-label="手機導覽"><button className={mobileView === 'overview' ? 'active' : ''} onClick={() => setMobileView('overview')}>總覽</button><button className={mobileView === 'add' ? 'active' : ''} onClick={() => setMobileView('add')}>新增</button><button className={mobileView === 'transactions' ? 'active' : ''} onClick={() => setMobileView('transactions')}>交易</button><button className="mobile-settings" onClick={() => setSettingsOpen(true)} aria-label="設定"><GearIcon /><span>設定</span></button></nav>
    {settingsOpen && <SettingsDialog catalog={catalog} accountUsage={accountUsage} categoryUsage={categoryUsage} isEmpty={transactions.length === 0} driveConfigured={Boolean(CLIENT_ID)} autoSyncEnabled={Boolean(preferences.autoDriveSync)} backgroundSyncState={backgroundSyncState} onClose={() => setSettingsOpen(false)} onAddAccount={addAccount} onRenameAccount={renameAccount} onHideAccount={id => setAccountHidden(id, true)} onRestoreAccount={id => setAccountHidden(id, false)} onDeleteAccount={deleteAccount} onAddCategory={addCategory} onUpdateCategory={updateCategory} onHideCategory={id => setCategoryHidden(id, true)} onRestoreCategory={id => setCategoryHidden(id, false)} onDeleteCategory={deleteCategory} onBackup={() => downloadJson(backupPayload())} onRestoreFile={restoreLocalBackup} onSync={syncDrive} syncing={syncing} lastSynced={preferences.lastDriveSync} />}{statsOpen && <StatsDialog ledger={ledger} accounts={allAccounts} categoryDefinitions={categoryDefinitions} onClose={() => setStatsOpen(false)} onEdit={record => setEditing(record)} onSettings={() => { setStatsOpen(false); setSettingsOpen(true); }} />}{editing && <EditDialog record={editing} accounts={accounts} categories={categories} onClose={() => setEditing(null)} onSave={saveEditedTransaction} onDelete={deleteTransaction} />}
    {notice && <div className="toast" onAnimationEnd={() => setNotice('')}>{notice}</div>}
  </main>;
}
