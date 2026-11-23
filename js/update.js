// Getting new versions onto the device.
//
// How a change reaches Ebbe's phone:
//   1. Claude pushes to main.
//   2. GitHub Actions publishes the site (about a minute).
//   3. Ebbe taps Force update in Settings (or the "new version" note).
//
// The service worker (sw.js) already fetches fresh files whenever the device
// is online, so a plain reopen usually shows the new version. Force update is
// the sure way: it throws away every saved copy and reloads.

import { BUILD } from './version.js';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // The version is in the address, so a new version installs a new worker.
  navigator.serviceWorker.register('sw.js?v=' + BUILD).catch((e) => {
    console.warn('dashboard: service worker not registered:', e && e.message);
  });
}

// Ask the web for the version that is online now. Returns a number, or null
// when offline or unreachable.
export async function onlineBuild() {
  try {
    const res = await fetch('js/version.js?check=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    const m = /BUILD\s*=\s*(\d+)/.exec(await res.text());
    return m ? Number(m[1]) : null;
  } catch (e) {
    return null;
  }
}

export async function forceUpdate() {
  try {
    // 1. Delete the service worker's saved copies.
    if (window.caches) {
      for (const k of await caches.keys()) await caches.delete(k);
    }
    // 2. Fetch every file this page loaded again, skipping the browser's own
    //    cache, so the reload below cannot pick up an old copy.
    const urls = new Set([location.href.split('#')[0]]);
    for (const entry of performance.getEntriesByType('resource')) {
      const u = new URL(entry.name);
      if (u.origin === location.origin && !u.search) urls.add(u.href);
    }
    await Promise.all([...urls].map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
    // 3. Drop the service worker itself; the reloaded page registers the new one.
    if ('serviceWorker' in navigator) {
      for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    }
  } catch (e) {
    // Whatever failed, the reload still happens.
  }
  location.reload();
}
