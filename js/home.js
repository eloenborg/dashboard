// The home screen: "Hello, world." plus the Ask Claude box.
//
// This is the blank canvas the dashboard grows from. When Ebbe asks for
// widgets, they go in #dashboard (index.html), above the Ask Claude box.

import { state } from './store.js';
import { BUILD } from './version.js';
import { ask, isConnected } from './ask.js';
import { onlineBuild, forceUpdate } from './update.js';
import { $, esc, clock, dayAndClock, safeHref } from './ui.js';

const SHOW = 8;                  // past messages listed under the box
const WATCH_MS = 15 * 60e3;      // after sending, look for a new version this long
const WATCH_EVERY = 20e3;

let watchUntil = 0;
let watchTimer = null;

export function initHome() {
  const box = $('#askText');
  $('#askSend').addEventListener('click', send);
  // Ctrl/Cmd + Enter sends from a keyboard
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  });
  $('#updateNow').addEventListener('click', () => {
    $('#updateNow').textContent = 'Updating…';
    forceUpdate();
  });
  $('#askHistory').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-refill]');
    if (!btn) return;
    const item = state.asks.find((a) => a.id === btn.dataset.refill);
    if (item) { box.value = item.text; box.focus(); }
  });
  document.addEventListener('dashboard:changed', renderHistory);
  // coming back to the app (e.g. from the Claude app) is a good moment to look
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  checkForUpdate();
}

export function renderHome() {
  $('#askMode').textContent = isConnected()
    ? 'Goes straight to Claude.'
    : 'Opens the Claude app with your message filled in. Connect in Settings to skip that step.';
  renderHistory();
}

async function send() {
  const box = $('#askText');
  const btn = $('#askSend');
  const status = $('#askStatus');
  status.className = 'status';
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const entry = await ask(box.value);
    if (entry.status === 'sent') {
      box.value = '';
      status.innerHTML = 'Sent to Claude at ' + esc(clock(entry.at)) + '. Claude is working on it now.' +
        (safeHref(entry.sessionUrl) ? ' <a href="' + esc(safeHref(entry.sessionUrl)) + '" target="_blank" rel="noopener">Open in Claude ↗</a>' : '');
      watchForUpdate();
    } else if (entry.status === 'opened') {
      box.value = '';
      status.textContent = 'Opened in Claude with your message filled in. Tap send there.';
      watchForUpdate();
    } else {
      status.className = 'status bad';
      status.textContent = 'Not sent: ' + entry.error;
    }
  } catch (e) {
    status.className = 'status bad';
    status.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ask Claude';
  }
}

function renderHistory() {
  const list = $('#askHistory');
  const items = state.asks.slice(0, SHOW);
  if (!items.length) { list.innerHTML = ''; return; }
  list.innerHTML = '<h2>Recent messages</h2>' + items.map((a) => {
    let meta;
    const href = safeHref(a.sessionUrl);
    if (a.status === 'sent') {
      meta = 'Sent ' + esc(dayAndClock(a.at)) +
        (href ? ' · <a href="' + esc(href) + '" target="_blank" rel="noopener">Open in Claude ↗</a>' : '');
    } else if (a.status === 'opened') {
      meta = 'Opened in the Claude app ' + esc(dayAndClock(a.at));
    } else if (a.status === 'failed') {
      meta = '<span class="bad">Not sent ' + esc(dayAndClock(a.at)) + ': ' + esc(a.error) + '</span>' +
        ' · <button class="link" data-refill="' + esc(a.id) + '">Put back in the box</button>';
    } else {
      meta = 'Sending…';
    }
    return '<div class="ask-item"><div class="ask-text">' + esc(a.text) + '</div>' +
      '<div class="ask-meta">' + meta + '</div></div>';
  }).join('');
}

// After a message goes out, keep checking whether Claude's change is online.
function watchForUpdate() {
  watchUntil = Date.now() + WATCH_MS;
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    if (Date.now() > watchUntil) { clearInterval(watchTimer); watchTimer = null; return; }
    checkForUpdate();
  }, WATCH_EVERY);
}

async function checkForUpdate() {
  const online = await onlineBuild();
  const note = $('#updateNote');
  if (online && online > BUILD) {
    $('#updateText').textContent = 'A new version (v' + online + ') is online. This device has v' + BUILD + '.';
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}
