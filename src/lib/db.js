const DB = 'daily-book-ver4';
const VERSION = 2;
const open = () => new Promise((resolve, reject) => { const r = indexedDB.open(DB, VERSION); r.onupgradeneeded = () => { const d = r.result; if(!d.objectStoreNames.contains('transactions')) d.createObjectStore('transactions', { keyPath: 'id' }); if(!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' }); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
export async function all(store) { const db = await open(); return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
export async function put(store, value) { const db = await open(); return new Promise((resolve, reject) => { const r = db.transaction(store, 'readwrite').objectStore(store).put(value); r.onsuccess = resolve; r.onerror = () => reject(r.error); }); }
export const settingsObject = entries => Object.fromEntries(entries.map(({ key, value }) => [key, value]));
