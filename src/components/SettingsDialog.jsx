import { useEffect, useRef, useState } from 'react';

export function GearIcon() {
  return <svg className="gear-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z"/><path d="M19.1 13.2a7.7 7.7 0 0 0 .05-1.2 7.7 7.7 0 0 0-.05-1.2l2-1.55-2-3.46-2.45.98a8.2 8.2 0 0 0-2.08-1.2L14.2 3h-4l-.38 2.57a8.2 8.2 0 0 0-2.08 1.2L5.3 5.79l-2 3.46 2 1.55A7.7 7.7 0 0 0 5.25 12c0 .4.03.8.08 1.2l-2 1.55 2 3.46 2.44-.98c.63.5 1.33.9 2.08 1.2L10.2 21h4l.38-2.57a8.2 8.2 0 0 0 2.08-1.2l2.45.98 2-3.46-2-1.55Z"/></svg>;
}

function CatalogItem({ item, type, usage, sorting, canMoveUp, canMoveDown, onStartSort, onEndSort, onMove, onEdit, onHide, onRestore, onDelete }) {
  const holdTimer = useRef(null);
  const startPoint = useRef(null);
  const cancelHold = () => { clearTimeout(holdTimer.current); holdTimer.current = null; startPoint.current = null; };
  const beginHold = event => {
    if (event.button !== 0 || event.target.closest('button, input, label')) return;
    cancelHold();
    startPoint.current = { x: event.clientX, y: event.clientY };
    holdTimer.current = setTimeout(() => {
      onStartSort(item.id);
      navigator.vibrate?.(20);
    }, 520);
  };
  const trackHold = event => {
    if (!startPoint.current) return;
    if (Math.hypot(event.clientX - startPoint.current.x, event.clientY - startPoint.current.y) > 10) cancelHold();
  };
  useEffect(() => () => cancelHold(), []);
  return <article className={`catalog-item${item.hidden ? ' is-hidden' : ''}${sorting ? ' is-sorting' : ''}`} data-catalog-id={item.id} onPointerDown={beginHold} onPointerMove={trackHold} onPointerUp={cancelHold} onPointerCancel={cancelHold} onContextMenu={event => event.preventDefault()}>
    <div className="catalog-copy">
      <strong>{item.name}</strong>
      <small>{usage ? `${usage} 筆流水` : '尚無流水'}{type === 'category' && <> · {item.investment ? '投資項目' : item.systemRole === 'saving' ? '儲蓄統計' : item.systemRole === 'transfer' ? '轉帳統計' : '一般分類'}</>}</small>
    </div>
    <div className="catalog-actions">
      {sorting
        ? <div className="catalog-order-controls"><button type="button" disabled={!canMoveUp} onClick={() => onMove(item.id, -1)} aria-label={`上移${item.name}`}>上移</button><button type="button" disabled={!canMoveDown} onClick={() => onMove(item.id, 1)} aria-label={`下移${item.name}`}>下移</button><button className="order-done" type="button" onClick={onEndSort}>完成</button></div>
        : item.hidden
        ? <><button className="catalog-restore" type="button" onClick={() => onRestore(item.id)}>重新開啟</button>{usage === 0 && <button className="catalog-delete" type="button" onClick={() => onDelete(item.id)}>永久刪除</button>}</>
        : <><button type="button" onClick={() => onEdit(item)}>編輯</button><button className="catalog-hide" type="button" onClick={() => onHide(item.id)}>隱藏</button></>}
    </div>
  </article>;
}

function CatalogSection({ type, items, usage, onAdd, onEdit, onHide, onRestore, onDelete, onMove }) {
  const [name, setName] = useState('');
  const [investment, setInvestment] = useState(false);
  const [sortingId, setSortingId] = useState(null);
  const active = items.filter(item => !item.hidden);
  const hidden = items.filter(item => item.hidden);
  const submit = async event => {
    event.preventDefault();
    if (await onAdd(name, investment)) { setName(''); setInvestment(false); }
  };
  const noun = type === 'account' ? '帳戶' : '分類';
  const itemCard = (item, peers) => {
    const index = peers.findIndex(peer => peer.id === item.id);
    return <CatalogItem key={item.id} item={item} type={type} usage={usage[item.name] || 0} sorting={sortingId === item.id} canMoveUp={index > 0} canMoveDown={index < peers.length - 1} onStartSort={setSortingId} onEndSort={() => setSortingId(null)} onMove={onMove} onEdit={item => onEdit(type, item)} onHide={onHide} onRestore={onRestore} onDelete={onDelete} />;
  };
  return <section className="settings-section" aria-labelledby={`${type}-settings-title`}>
    <div className="settings-section-heading"><div><h3 id={`${type}-settings-title`}>{noun}管理</h3><p>共 {active.length} 個使用中{hidden.length ? `，${hidden.length} 個已隱藏` : ''} · 長按項目可調整順序</p></div></div>
    <form className="catalog-add" onSubmit={submit}>
      <label><span>新增{noun}</span><input value={name} onChange={event => setName(event.target.value)} placeholder={`輸入${noun}名稱`} maxLength="24" required /></label>
      {type === 'category' && <label className="new-investment"><input type="checkbox" checked={investment} onChange={event => setInvestment(event.target.checked)} /><span>設為投資項目</span></label>}
      <button className="primary">新增</button>
    </form>
    <div className="catalog-list" aria-label={`使用中的${noun}`}>{active.map(item => itemCard(item, active))}</div>
    {hidden.length > 0 && <details className="hidden-catalog"><summary>已隱藏的{noun} <span>{hidden.length}</span></summary><div className="catalog-list">{hidden.map(item => itemCard(item, hidden))}</div></details>}
  </section>;
}

function CatalogEditor({ editor, draft, investment, onDraftChange, onInvestmentChange, onCancel, onSave }) {
  const noun = editor.type === 'account' ? '帳戶' : '分類';
  return <div className="catalog-edit-layer" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="catalog-edit-panel" role="dialog" aria-modal="true" aria-labelledby="catalog-edit-title">
      <header><div><small>帳本結構</small><h3 id="catalog-edit-title">編輯{noun}</h3></div><button type="button" onClick={onCancel} aria-label="關閉編輯">×</button></header>
      <p>目前名稱 <strong>{editor.item.name}</strong></p>
      <form onSubmit={onSave}>
        <label><span>新的{noun}名稱</span><input value={draft} onChange={event => onDraftChange(event.target.value)} maxLength="24" required autoFocus /></label>
        {editor.type === 'category' && <label className="edit-investment"><input type="checkbox" checked={investment} onChange={event => onInvestmentChange(event.target.checked)} /><span>設為投資項目</span></label>}
        <div className="catalog-edit-actions"><button type="button" onClick={onCancel}>取消</button><button className="primary">儲存變更</button></div>
      </form>
    </section>
  </div>;
}

function SyncSection({ isEmpty, driveConfigured, autoSyncEnabled, backgroundSyncState, onBackup, onRestoreFile, onSync, syncing, lastSynced }) {
  const syncDescription = {
    preparing: '正在準備背景同步…',
    syncing: '正在背景合併並備份…',
    synced: '背景同步已完成',
    'waiting-auth': '等待下次送出或手動同步以續權',
    offline: '目前離線；恢復連線後會再嘗試',
    error: '背景同步未完成，稍後會再嘗試',
  }[backgroundSyncState];
  return <section className="settings-section sync-settings" aria-labelledby="sync-settings-title">
    <div className="settings-section-heading"><div><h3 id="sync-settings-title">資料與同步</h3><p>{isEmpty ? '這台裝置尚無帳目，可從私密備份安全還原。' : 'IndexedDB 是主資料庫，Google Drive 保存私密備份。'}</p></div></div>
    <article className="settings-card"><div><strong>本機資料庫</strong><small>歷史帳目不包含在公開網站或 GitHub 原始碼中。</small></div>{isEmpty ? <label className="file-picker">從本機私密備份還原<input type="file" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) onRestoreFile(file); event.target.value = ''; }} /></label> : <button onClick={onBackup}>下載安全備份</button>}</article>
    <article className="settings-card"><div><strong>Google Drive</strong><small><i className={driveConfigured ? 'online' : 'offline'}></i>{driveConfigured ? syncDescription || (autoSyncEnabled ? '載入與送出交易後會自動嘗試同步' : '登入同步後將自動備份新交易') : '尚未設定 Google OAuth Client ID'}</small></div><button className="primary" disabled={!driveConfigured || syncing} onClick={onSync}>{syncing ? '正在安全處理…' : isEmpty ? '登入並私密還原' : autoSyncEnabled ? '立即同步' : '登入並同步'}</button>{lastSynced && <small className="last-sync">上次同步：{new Date(lastSynced).toLocaleString('zh-TW')}</small>}</article>
  </section>;
}

export default function SettingsDialog(props) {
  const [section, setSection] = useState(props.isEmpty ? 'sync' : 'accounts');
  const [editor, setEditor] = useState(null);
  const [draft, setDraft] = useState('');
  const [investmentDraft, setInvestmentDraft] = useState(false);
  const sections = [['accounts', '帳戶'], ['categories', '分類'], ['sync', '資料']];
  const beginEdit = (type, item) => { setEditor({ type, item }); setDraft(item.name); setInvestmentDraft(Boolean(item.investment)); };
  const closeEditor = () => setEditor(null);
  const saveEditor = async event => {
    event.preventDefault();
    const saved = editor.type === 'account'
      ? await props.onRenameAccount(editor.item.id, draft)
      : await props.onUpdateCategory(editor.item.id, draft, investmentDraft);
    if (saved) closeEditor();
  };
  useEffect(() => {
    if (!editor) return undefined;
    const closeOnEscape = event => { if (event.key === 'Escape') closeEditor(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [editor]);
  return <dialog open className="settings-dialog" aria-labelledby="settings-title">
    <div className="settings-shell" inert={editor ? true : undefined}>
      <header className="settings-header"><div className="settings-title"><GearIcon /><div><h2 id="settings-title">設定</h2><small>帳本結構與私密同步</small></div></div><button className="settings-close" onClick={props.onClose} aria-label="關閉">×</button></header>
      <nav className="settings-tabs" aria-label="設定分類">{sections.map(([value, label]) => <button className={section === value ? 'active' : ''} key={value} onClick={() => { closeEditor(); setSection(value); }}>{label}</button>)}</nav>
      <div className="settings-body">
        {section === 'accounts' && <CatalogSection type="account" items={props.catalog.accounts} usage={props.accountUsage} onAdd={props.onAddAccount} onEdit={beginEdit} onHide={props.onHideAccount} onRestore={props.onRestoreAccount} onDelete={props.onDeleteAccount} onMove={props.onMoveAccount} />}
        {section === 'categories' && <CatalogSection type="category" items={props.catalog.categories} usage={props.categoryUsage} onAdd={props.onAddCategory} onEdit={beginEdit} onHide={props.onHideCategory} onRestore={props.onRestoreCategory} onDelete={props.onDeleteCategory} onMove={props.onMoveCategory} />}
        {section === 'sync' && <SyncSection {...props} />}
      </div>
    </div>
    {editor && <CatalogEditor editor={editor} draft={draft} investment={investmentDraft} onDraftChange={setDraft} onInvestmentChange={setInvestmentDraft} onCancel={closeEditor} onSave={saveEditor} />}
  </dialog>;
}
