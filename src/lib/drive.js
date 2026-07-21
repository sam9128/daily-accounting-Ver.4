const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'daily-book-ver4.json';

let accessToken = null;

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Identity Services 載入失敗'));
    document.head.append(script);
  });
}

export async function connectDrive(clientId) {
  if (!clientId) throw new Error('此部署尚未設定 VITE_GOOGLE_CLIENT_ID。');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: response => {
        if (response.error) return reject(new Error(response.error));
        accessToken = response.access_token;
        resolve();
      },
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
}

async function api(url, init = {}) {
  if (!accessToken) throw new Error('Google Drive 授權已失效，請重新連線。');
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
  });
  if (!response.ok) throw new Error(`Drive 同步失敗 (${response.status})`);
  return response;
}

async function findBackup() {
  const query = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const result = await api(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  return (await result.json()).files?.[0] ?? null;
}

export async function downloadBackup() {
  const file = await findBackup();
  if (!file) return null;
  const response = await api(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
  const payload = await response.json();
  if (![4, 5, 6].includes(payload?.schema) || !Array.isArray(payload.transactions)) {
    throw new Error('Drive 備份格式不相容。');
  }
  return payload;
}

export async function uploadBackup(payload) {
  const existing = await findBackup();
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' })], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  await api(url, { method: existing ? 'PATCH' : 'POST', body: form });
}

// Deterministic conflict policy: the newest edited record wins; ties favour local data.
export function mergeTransactions(local, remote) {
  const byId = new Map(local.map(record => [record.id, record]));
  for (const record of remote) {
    const current = byId.get(record.id);
    if (!current || String(record.updatedAt || '') > String(current.updatedAt || '')) byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}
