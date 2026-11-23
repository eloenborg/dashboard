// Ask Claude: how a message typed in the dashboard reaches Ebbe's Claude.
//
// Connected (the normal way):
//   dashboard  --POST-->  relay (Google Apps Script in Ebbe's Google account)
//              --POST-->  Claude scheduled task "fire" endpoint (his Claude account)
//   The task starts a Claude Code session on this repo straight away. Claude
//   answers there (Ebbe reads it in the Claude app) and, for app changes,
//   pushes to main. The relay is needed because Anthropic's endpoint does not
//   accept calls from web pages (no CORS), and because the task's token must
//   not sit in a public repo or on the phone. Setup: README.md.
//
// Not connected yet (fallback):
//   The button opens the Claude app (or claude.ai on a computer) with the
//   message and this repo filled in, and Ebbe taps send there.
//
// The relay address and passphrase are kept per device under their own
// localStorage key, never in `state`, never in exports, never in the repo.

import { state, changed, uid } from './store.js';
import { BUILD } from './version.js';
import { REPO, BRANCH, OWNER, TIME_ZONE } from './config.js';

const CFG_KEY = 'dashboard.askClaude';
const MAX_TEXT = 8000;
const KEEP = 30;   // how many past messages the home screen remembers

export function askConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch (e) { return {}; }
}

export function setAskConfig({ url, pass }) {
  const clean = { url: String(url || '').trim(), pass: String(pass || '').trim() };
  if (clean.url || clean.pass) localStorage.setItem(CFG_KEY, JSON.stringify(clean));
  else localStorage.removeItem(CFG_KEY);
}

export function isConnected() {
  const c = askConfig();
  return !!(c.url && c.pass);
}

// ---------- what Claude receives ----------

function deviceKind() {
  const ua = navigator.userAgent || '';
  if (/iPhone/.test(ua)) return 'an iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'an iPad';
  if (/Android/.test(ua)) return 'an Android phone';
  if (/Macintosh/.test(ua)) return 'a Mac';
  if (/Windows/.test(ua)) return 'a Windows computer';
  return 'a computer';
}

function installed() {
  return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

export function isPhone() {
  return /iPhone|iPad|Android/.test(navigator.userAgent || '') ||
    (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);
}

// The text sent to Claude: who, when, which version, then the message itself.
export function messageFor(text, now = new Date()) {
  const when = now.toLocaleString('en-GB', {
    timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return [
    'Ask Claude message from ' + OWNER + ', typed into his dashboard (repo ' + REPO + ').',
    'Sent ' + when + ' (Copenhagen time), from v' + BUILD + ' of the app, ' +
      (installed() ? 'opened as the installed app' : 'opened in a browser') + ' on ' + deviceKind() + '.',
    '',
    '---',
    text,
  ].join('\n');
}

// ---------- fallback: open the Claude app with the message filled in ----------

export function claudeAppLink(text) {
  const q = new URLSearchParams({ q: messageFor(text), repo: REPO, branch: BRANCH }).toString();
  // On a phone the claude:// address opens the Claude app. On a computer the
  // web address opens Claude Code in the browser.
  return isPhone() ? 'claude://code/new?' + q : 'https://claude.ai/code/new?' + q;
}

// ---------- the relay ----------

async function relay(body) {
  const { url } = askConfig();
  if (!url) throw new Error('No relay address yet. Add it in Settings.');
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      // text/plain keeps this a "simple" request, which Apps Script can answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
  } catch (e) {
    throw new Error(navigator.onLine === false
      ? 'This device is offline. Your message is still in the box.'
      : 'Could not reach the relay. Check the relay address in Settings.');
  }
  const raw = await res.text();
  let j;
  try { j = JSON.parse(raw); } catch (e) {
    throw new Error('That address did not answer like the relay. It should be the Web app address ending in /exec.');
  }
  if (!j.ok) throw new Error(j.error || 'The relay refused the message.');
  return j;
}

// Settings → Test. Checks the address, the passphrase and the Claude link.
export async function testConnection() {
  const { pass } = askConfig();
  const j = await relay({ action: 'ping', passphrase: pass });
  return j.ready
    ? 'Connected. Messages go straight to Claude.'
    : 'The relay works, but it has no Claude task yet. Add FIRE_URL and FIRE_TOKEN in the relay (README step 3).';
}

// ---------- sending ----------

// Returns the history entry. Throws only for an empty or too-long message.
export async function ask(text) {
  text = String(text || '').trim();
  if (!text) throw new Error('Type a message first.');
  if (text.length > MAX_TEXT) throw new Error('That message is too long (' + text.length + ' characters; the limit is ' + MAX_TEXT + ').');

  const entry = { id: uid(), at: Date.now(), text, status: 'sending', sessionUrl: '', error: '' };
  state.asks.unshift(entry);
  state.asks.length = Math.min(state.asks.length, KEEP);
  changed();

  if (!isConnected()) {
    entry.status = 'opened';
    changed();
    // This runs before any await, so the browser still counts it as the tap.
    const link = claudeAppLink(text);
    if (isPhone()) {
      location.href = link;                         // opens the Claude app
    } else {
      const tab = window.open(link, '_blank');      // keeps the dashboard open
      if (tab) tab.opener = null; else location.href = link;
    }
    return entry;
  }

  try {
    const { pass } = askConfig();
    const j = await relay({ action: 'ask', passphrase: pass, text: messageFor(text) });
    entry.status = 'sent';
    entry.sessionUrl = String(j.sessionUrl || '');
  } catch (e) {
    entry.status = 'failed';
    entry.error = e.message;
  }
  changed();
  return entry;
}
