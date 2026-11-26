// Ebbe's data: pages, record types, records, views and briefs.
//
// Where it lives:
//   - On his Google Drive, in the "Dashboard data" folder, reached only
//     through his own gateway script (gateway/gateway.gs). That is the real copy.
//   - On each device, a copy in IndexedDB, so the app opens and works
//     offline. Changes made offline wait in an outbox and go up when the
//     device is back online.
//   - NEVER in this repo. The code only knows how to show data, not what it is.
//
// The shape: a flat set of items. Every item has
//   { id, kind, updatedAt, ...whatever its kind needs }
// and the gateway adds rev, by ('app' or 'claude'), createdAt and createdBy.
// Deleting writes a tombstone { id, kind, deleted: true, updatedAt }, so the
// delete reaches every device. When two writers change the same item, the
// newer updatedAt wins (the gateway decides, the same way here).
//
// The gateway address and key are kept per device under their own
// localStorage key, never with the data, never in exports, never in the repo.

const CFG_KEY = 'dashboard.gateway';
const DB_NAME = 'dashboard';
const DB_STORE = 'kv';
const DB_KEY = 'workspace';
const PUSH_DELAY = 1200;        // wait this long after a change before sending it
const PULL_EVERY = 60e3;        // look for changes from other devices and Claude

const items = new Map();        // id -> item (including tombstones)
const outbox = new Map();       // id -> item changed here and not yet on Drive
let rev = 0;                    // the gateway revision this device has seen
let loaded = false;

export const sync = {
  state: 'local',               // local | syncing | synced | offline | error
  error: '',
  lastSync: 0,
};

// ---------------------------------------------------------------- reading

export function get(id) {
  const it = items.get(id);
  return it && !it.deleted ? it : null;
}

export function all(kind) {
  const out = [];
  for (const it of items.values()) if (!it.deleted && (!kind || it.kind === kind)) out.push(it);
  return out;
}

export function isLoaded() { return loaded; }
export function pendingCount() { return outbox.size; }

// ---------------------------------------------------------------- writing

// Saves a whole item (a new one, or a changed copy of an existing one).
// Returns the saved item.
export function put(item) {
  if (!item || !item.id || !item.kind) throw new Error('put() needs an item with an id and a kind');
  const prev = items.get(item.id);
  const now = Date.now();
  const updatedAt = prev && prev.updatedAt >= now ? prev.updatedAt + 1 : now;
  const saved = { ...item, updatedAt };
  if (!prev) saved.createdAt = saved.createdAt || now;
  delete saved.rev;
  items.set(saved.id, saved);
  outbox.set(saved.id, saved);
  afterChange();
  return saved;
}

// Changes some fields of an item: patch(id, { title: 'New' }).
export function patch(id, fields) {
  const cur = get(id);
  if (!cur) return null;
  return put({ ...cur, ...fields });
}

export function remove(id) {
  const cur = items.get(id);
  if (!cur || cur.deleted) return;
  put({ id, kind: cur.kind, deleted: true });
}

// Merges items that came from the gateway (or another source of whole
// items). A local change that is newer and not yet sent is kept.
export function applyIncoming(list) {
  let any = false;
  for (const s of list || []) {
    if (!s || !s.id) continue;
    const mine = outbox.get(s.id);
    if (mine && mine.updatedAt > (s.updatedAt || 0)) continue;   // ours is newer: keep it, send it
    if (mine) outbox.delete(s.id);                                // theirs is as new or newer
    if (!mine) {
      const cur = items.get(s.id);
      if (cur && cur.rev && s.rev && cur.rev >= s.rev && cur.updatedAt >= s.updatedAt) continue;
    }
    items.set(s.id, s);
    any = true;
  }
  if (any) { persistSoon(); emit(); }
  return any;
}

function afterChange() {
  persistSoon();
  emit();
  pushSoon();
}

function emit() {
  if (typeof document !== 'undefined' && document.dispatchEvent && typeof CustomEvent !== 'undefined') {
    document.dispatchEvent(new CustomEvent('dashboard:data'));
  }
}

// ------------------------------------------------------- device copy (IndexedDB)

let dbPromise = null;
function db() {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { console.warn('dashboard: no IndexedDB:', e && e.message); return null; });
  }
  return dbPromise;
}

async function idbGet(key) {
  const d = await db();
  if (!d) return memoryCopy.get(key);
  return new Promise((resolve) => {
    const req = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function idbSet(key, value) {
  const d = await db();
  if (!d) { memoryCopy.set(key, value); return; }
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const memoryCopy = new Map();   // used where there is no IndexedDB (tests)

export let deviceCopyFailed = false;
let persistTimer = null;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 250);
}

export async function persistNow() {
  clearTimeout(persistTimer);
  try {
    await idbSet(DB_KEY, { rev, items: [...items.values()], outbox: [...outbox.keys()] });
    deviceCopyFailed = false;
  } catch (e) {
    deviceCopyFailed = true;
    console.warn('dashboard: could not save the device copy:', e && e.message);
  }
}

export async function loadData() {
  const saved = await idbGet(DB_KEY);
  if (saved && Array.isArray(saved.items)) {
    items.clear();
    outbox.clear();
    for (const it of saved.items) items.set(it.id, it);
    for (const id of saved.outbox || []) if (items.has(id)) outbox.set(id, items.get(id));
    rev = Number(saved.rev) || 0;
  }
  loaded = true;
  sync.state = isDataConnected() ? 'syncing' : 'local';
  emit();
  return { items: items.size, pending: outbox.size };
}

// Forget the device copy (Settings → "Forget on this device"). The Drive copy
// is untouched; a connected device fetches everything again.
export async function forgetDeviceCopy() {
  items.clear();
  outbox.clear();
  rev = 0;
  await persistNow();
  emit();
}

// ---------------------------------------------------------- the gateway

export function gatewayConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; }
}

export function setGatewayConfig({ url, key }) {
  const clean = { url: String(url || '').trim(), key: String(key || '').trim() };
  const before = gatewayConfig();
  if (clean.url || clean.key) localStorage.setItem(CFG_KEY, JSON.stringify(clean));
  else localStorage.removeItem(CFG_KEY);
  // A different gateway is a different Drive: read it all again, and send
  // everything this device has, so nothing is lost either way.
  if (before.url !== clean.url) {
    rev = 0;
    for (const it of items.values()) outbox.set(it.id, it);
    persistSoon();
  }
}

export function isDataConnected() {
  const c = gatewayConfig();
  return !!(c.url && c.key);
}

export function validGatewayUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url);
}

async function call(body) {
  const { url, key } = gatewayConfig();
  if (!url || !key) throw new Error('Not connected to Google Drive yet. Add the gateway in Settings.');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      // text/plain keeps this a "simple" request, which Apps Script can answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key }),
      redirect: 'follow',
    });
  } catch (e) {
    const err = new Error(typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'This device is offline. Changes are kept here and sent when it is back online.'
      : 'Could not reach the gateway. Check its address in Settings.');
    err.offline = true;
    throw err;
  }
  const raw = await res.text();
  let j;
  try { j = JSON.parse(raw); } catch (e) {
    throw new Error('That address did not answer like the gateway. It should be the Web app address ending in /exec.');
  }
  if (!j.ok) throw new Error(j.error || 'The gateway refused.');
  return j;
}

// Settings → Save and test.
export async function testGateway() {
  const j = await call({ action: 'ping' });
  if (j.role === 'claude') {
    throw new Error('That is the Claude key. Use the APP key on your devices; the Claude key belongs in the Claude task settings only.');
  }
  return 'Connected. Your data is saved on Google Drive.';
}

// Saves a picture in the "Ask Claude pictures" folder on Drive.
// { name, mimeType, data (base64) } -> { id, name, mimeType, size }
export async function uploadPicture(pic) {
  const j = await call({ action: 'filePut', name: pic.name, mimeType: pic.mimeType, data: pic.data });
  return j.file;
}

let syncing = null;
let again = false;

// Sends what changed here, then takes what changed elsewhere.
export function syncNow() {
  if (!isDataConnected()) { sync.state = 'local'; emitSync(); return Promise.resolve(false); }
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    sync.state = 'syncing';
    emitSync();
    try {
      do {
        again = false;
        const sending = [...outbox.values()];
        const j = sending.length
          ? await call({ action: 'push', since: rev, items: sending })
          : await call({ action: 'pull', since: rev });
        // accepted items: drop from the outbox unless changed again meanwhile
        const acceptedIds = new Set(j.accepted || []);
        for (const it of sending) {
          if (acceptedIds.has(it.id) && outbox.get(it.id) === it) outbox.delete(it.id);
        }
        applyIncoming(j.items);
        rev = Math.max(rev, Number(j.rev) || 0);
        await persistNow();
      } while (again);
      sync.state = 'synced';
      sync.error = '';
      sync.lastSync = Date.now();
      return true;
    } catch (e) {
      sync.state = e.offline ? 'offline' : 'error';
      sync.error = e.message;
      return false;
    } finally {
      syncing = null;
      emitSync();
    }
  })();
  return syncing;
}

function emitSync() {
  if (typeof document !== 'undefined' && document.dispatchEvent && typeof CustomEvent !== 'undefined') {
    document.dispatchEvent(new CustomEvent('dashboard:sync'));
  }
}

let pushTimer = null;
function pushSoon() {
  if (!isDataConnected()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(syncNow, PUSH_DELAY);
}

// Starts the background syncing: now, when the app comes back to the
// screen, when the device comes online, and every minute while open.
export function startSync() {
  syncNow();
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  }
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', () => syncNow());
  setInterval(() => {
    if (typeof document === 'undefined' || !document.hidden) syncNow();
  }, PULL_EVERY);
}

// For tests: start from nothing.
export function _reset() {
  items.clear(); outbox.clear(); rev = 0; loaded = false; memoryCopy.clear();
  sync.state = 'local'; sync.error = ''; sync.lastSync = 0;
}
export function _rev() { return rev; }
