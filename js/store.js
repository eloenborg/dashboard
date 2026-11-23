// The app's data, kept in this browser's localStorage under one key.
//
// Everything the dashboard saves goes in `state` and is written with save().
// It stays on this device: there is no server and no sync. Add new top-level
// fields to DEFAULTS so old saved data still loads.
//
// Secrets (the Ask Claude relay address and passphrase) are NOT kept here.
// They have their own key in ask.js, so exportJSON() can never leak them.

const KEY = 'dashboard.v1';

const DEFAULTS = () => ({
  v: 1,
  asks: [],   // recent Ask Claude messages: { id, at, text, status, sessionUrl, error }
});

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') return { ...DEFAULTS(), ...saved };
  } catch (e) { /* nothing saved yet, or unreadable: start fresh */ }
  return DEFAULTS();
}

export const state = load();

// True after a save failed (storage full or blocked). Settings shows it.
export let storageFull = false;

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageFull = false;
    return true;
  } catch (e) {
    storageFull = true;
    console.warn('dashboard: could not save:', e && e.message);
    return false;
  }
}

// Tell every screen that the data changed, so it can redraw.
export function changed() {
  save();
  document.dispatchEvent(new CustomEvent('dashboard:changed'));
}

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  const incoming = JSON.parse(text);
  if (!incoming || typeof incoming !== 'object') throw new Error('not a dashboard export');
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, DEFAULTS(), incoming);
  changed();
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
