const KEY = 'daily-book-ver4.preferences';
export function loadPreferences() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
export function savePreferences(next) { localStorage.setItem(KEY, JSON.stringify(next)); }
