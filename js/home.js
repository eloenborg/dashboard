// Today: the quick look. A greeting, the latest daily brief, pinned pages
// and views (in #dashboard), recent pages, and the Ask Claude box.
//
// The brief is an item of kind "brief" that Claude's morning run writes:
//   { date: 'YYYY-MM-DD', title, sections: [{ title, items: [{ text, url, source }] }] }

import { state } from './store.js';
import * as data from './data.js';
import { renderView } from './views.js';
import { titleOf } from './model.js';
import { BUILD } from './version.js';
import { ask, isConnected, preparePicture, MAX_PICTURES } from './ask.js';
import { onlineBuild, forceUpdate } from './update.js';
import { $, esc, clock, dayAndClock, safeHref, icon, timeAgo } from './ui.js';

const SHOW = 8;                  // past messages listed under the box
const WATCH_MS = 15 * 60e3;      // after sending, look for a new version this long
const WATCH_EVERY = 20e3;

let pictures = [];               // ready to send with the next message
let preparing = 0;
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
  // pictures: the Picture button, pasting a screenshot, or dropping a file
  $('#askAddPic').addEventListener('click', () => $('#askFile').click());
  $('#askFile').addEventListener('change', (e) => {
    addPictures([...e.target.files]);
    e.target.value = '';
  });
  box.addEventListener('paste', (e) => {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); addPictures(files); }
  });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', (e) => {
    box.classList.remove('drop');
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); addPictures(files); }
  });
  $('#askPics').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-unpic]');
    if (!btn) return;
    pictures.splice(Number(btn.dataset.unpic), 1);
    renderPictures();
  });
  $('#askHistory').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-refill]');
    if (!btn) return;
    const item = state.asks.find((a) => a.id === btn.dataset.refill);
    if (item) { box.value = item.text; box.focus(); }
  });
  document.addEventListener('dashboard:changed', renderHistory);
  document.addEventListener('dashboard:data', () => { if (!$('#screen-home').hidden) renderToday(); });
  document.addEventListener('dashboard:sync', () => { if (!$('#screen-home').hidden) renderLocalNote(); });
  // coming back to the app (e.g. from the Claude app) is a good moment to look
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  checkForUpdate();
}

export function renderHome() {
  renderToday();
  $('#askMode').textContent = isConnected()
    ? 'Goes straight to Claude.'
    : 'Opens the Claude app with your message filled in. Connect in Settings to skip that step.';
  renderHistory();
}

async function addPictures(files) {
  const status = $('#askStatus');
  status.className = 'status';
  status.textContent = '';
  for (const f of files) {
    if (pictures.length + preparing >= MAX_PICTURES) {
      status.className = 'status bad';
      status.textContent = 'At most ' + MAX_PICTURES + ' pictures per message.';
      break;
    }
    preparing++;
    renderPictures();
    try { pictures.push(await preparePicture(f)); }
    catch (e) { status.className = 'status bad'; status.textContent = e.message; }
    finally { preparing--; renderPictures(); }
  }
}

function renderPictures() {
  const el = $('#askPics');
  el.hidden = !pictures.length && !preparing;
  el.innerHTML = pictures.map((p, i) =>
    '<div class="ask-pic"><img src="' + esc(p.thumb) + '" alt="' + esc(p.name) + '">' +
    '<button type="button" data-unpic="' + i + '" aria-label="Remove this picture">×</button></div>').join('') +
    (preparing ? '<div class="ask-pic busy">Adding…</div>' : '');
}

async function send() {
  const box = $('#askText');
  const btn = $('#askSend');
  const status = $('#askStatus');
  if (preparing) { status.className = 'status'; status.textContent = 'One moment, the picture is still being added.'; return; }
  status.className = 'status';
  btn.disabled = true;
  btn.textContent = pictures.length ? 'Sending pictures…' : 'Sending…';
  const sentPictures = pictures.length;
  try {
    const entry = await ask(box.value, pictures);
    if (entry.status === 'sent' || entry.status === 'opened') { pictures = []; renderPictures(); }
    if (entry.status === 'sent') {
      box.value = '';
      status.innerHTML = 'Sent to Claude at ' + esc(clock(entry.at)) + '. Claude is working on it now.' +
        (safeHref(entry.sessionUrl) ? ' <a href="' + esc(safeHref(entry.sessionUrl)) + '" target="_blank" rel="noopener">Open in Claude ↗</a>' : '');
      watchForUpdate();
    } else if (entry.status === 'opened') {
      box.value = '';
      status.textContent = sentPictures
        ? 'Opened in Claude with your message filled in. Add your picture there (the + button), then tap send.'
        : 'Opened in Claude with your message filled in. Tap send there.';
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
    if (a.pictures) meta += ' · ' + a.pictures + (a.pictures > 1 ? ' pictures' : ' picture');
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

// ---------------------------------------------------------------- the quick look

function renderToday() {
  const now = new Date();
  const h = now.getHours();
  $('#todayHello').textContent = h < 5 ? 'Good night.' : h < 12 ? 'Good morning.' : h < 18 ? 'Good afternoon.' : 'Good evening.';
  $('#todayDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  renderLocalNote();
  renderBrief();
  renderPinned();
  renderRecent();
}

function renderLocalNote() {
  const el = $('#localNote');
  const n = data.all().length;
  if (!data.isDataConnected() && n) {
    el.hidden = false;
    el.innerHTML = 'Saved on this device only. <a href="#settings">Connect Google Drive</a> to keep it safe and use it everywhere.';
  } else if (data.sync.state === 'error') {
    el.hidden = false;
    el.innerHTML = '<span class="bad">Sync problem: ' + esc(data.sync.error) + '</span> <a href="#settings">Settings</a>';
  } else {
    el.hidden = true;
  }
}

function renderBrief() {
  const el = $('#briefCard');
  const briefs = data.all('brief').sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const b = briefs[0];
  if (!b) {
    el.className = 'brief empty';
    el.innerHTML = '<h2>Daily brief</h2><p class="muted">Each morning Claude will put a short brief here: mail, calendar and the sites you follow. It starts once the morning task is set up.</p>';
    return;
  }
  const today = new Date().toLocaleDateString('en-CA');
  const when = b.date === today ? 'Today' : b.date ? new Date(b.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
  el.className = 'brief';
  el.innerHTML = '<div class="brief-head"><h2>' + esc(b.title || 'Daily brief') + '</h2><span class="muted small">' + esc(when) + '</span></div>' +
    (b.summary ? '<p class="brief-sum">' + esc(b.summary) + '</p>' : '') +
    '<div class="brief-sections">' + (b.sections || []).map((s) =>
      '<section class="brief-sec"><h3>' + esc(s.title || '') + '</h3><ul>' + (s.items || []).map((it) => {
        const href = safeHref(it.url);
        const text = esc(it.text || '');
        return '<li>' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + text + '</a>' : text) +
          (it.source ? ' <span class="muted small">' + esc(it.source) + '</span>' : '') + '</li>';
      }).join('') + '</ul></section>').join('') + '</div>';
}

function renderPinned() {
  const el = $('#dashboard');
  const pinned = data.all().filter((it) => it.pinned && (it.kind === 'view' || it.kind === 'page'))
    .sort((a, b) => (a.pinOrder || 0) - (b.pinOrder || 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!pinned.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<h2>Pinned</h2><div class="pins">' + pinned.map((it) => it.kind === 'view'
    ? '<div class="pin-view card flat"><div data-pin-view="' + esc(it.id) + '"></div></div>'
    : '<a class="pin-page card flat" href="#p/' + esc(it.id) + '">' + icon('page') + '<span>' + esc(titleOf(it)) + '</span></a>').join('') + '</div>';
  for (const host of el.querySelectorAll('[data-pin-view]')) renderView(host, host.dataset.pinView, { compact: true, limit: 5 });
}

function renderRecent() {
  const el = $('#recentPages');
  const list = data.all('page').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  if (!list.length) {
    el.innerHTML = '<h2>Pages</h2><p class="muted">No pages yet. <button type="button" class="link" data-new-page>Make your first page</button>, write anything in it, and Claude will organize it.</p>';
    return;
  }
  el.innerHTML = '<h2>Recent pages</h2><ul class="recent">' + list.map((p) => '<li><a href="#p/' + esc(p.id) + '">' + icon('page') +
    '<span class="r-title">' + esc(titleOf(p)) + '</span><span class="muted small">' + esc(timeAgo(p.updatedAt)) + '</span></a></li>').join('') + '</ul>';
}
