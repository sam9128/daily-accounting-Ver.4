import { registerSW } from 'virtual:pwa-register';

let reloadWithUpdate = null;
let swRegistration = null;
let pending = false;

export function watchForUpdates(onUpdateReady) {
  reloadWithUpdate = registerSW({
    onNeedRefresh() { pending = true; onUpdateReady(); },
    onRegisteredSW(_url, registration) { swRegistration = registration ?? null; },
  });
}

// A newly found worker starts out installing; wait for it to settle so the
// check reports the server's answer rather than the state mid-download.
function settled(worker, timeoutMs = 10_000) {
  if (!worker || worker.state !== 'installing') return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, timeoutMs);
    worker.addEventListener('statechange', () => { if (worker.state !== 'installing') finish(); });
  });
}

// 'updated' | 'current' | 'unsupported' | 'failed'
export async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const registration = swRegistration ?? (await navigator.serviceWorker.getRegistration().catch(() => null));
  if (!registration) return 'unsupported';
  swRegistration = registration;
  // autoUpdate builds call skipWaiting, so a new worker activates without ever
  // sitting in `waiting`; updatefound is the only reliable signal it existed.
  let found = false;
  const noteUpdate = () => { found = true; };
  registration.addEventListener('updatefound', noteUpdate);
  try {
    await registration.update();
    await settled(registration.installing);
  } catch {
    return 'failed';
  } finally {
    registration.removeEventListener('updatefound', noteUpdate);
  }
  return pending || found || Boolean(registration.waiting) ? 'updated' : 'current';
}

export async function applyUpdate() {
  if (reloadWithUpdate && swRegistration?.waiting) {
    await reloadWithUpdate(true);
    return;
  }
  // The new worker already took control; a plain reload picks up its assets.
  location.reload();
}
