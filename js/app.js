// The app shell: which screen shows, the page tree, the phone tab bar and
// top bar, the desktop sidebar, the item panel, and search.
//
// Addresses (the part after #):
//   today (or nothing)   Today: brief, pinned, recent, Ask Claude
//   ask                  Today, with the Ask Claude box ready to type in
//   p/<id>               a page
//   r/<id>               an item, in a side panel (computer) or full screen (phone)
//   v/<id>               a view on its own
//   pages                every page (the phone's Pages tab)
//   search               search
//   settings             settings
//
// One layout for both: CSS shows the sidebar from 900px wide, and the top
// bar and tab bar below that.

import { registerServiceWorker } from './update.js';
import { initHome, renderHome } from './home.js';
import { initSettings, renderSettings } from './settings.js';
import { initEditor, openPage, closePage, currentPage, flush as flushPage } from './editor.js';
import { initRecord, openRecord, closeRecord } from './record.js';
import { renderView } from './views.js';
import { loadData, startSync, sync, isDataConnected, get, all } from './data.js';
import { newPage, childPages, topPages, search, titleOf } from './model.js';
import { $, $$, esc, icon, fillIcons, isDesktop, closeMenu, menuOpen } from './ui.js';

const SCREEN_OF = { today: 'home', ask: 'home', page: 'page', view: 'view', pages: 'pages', search: 'pages', settings: 'settings' };
const UI_KEY = 'dashboard.ui';

let main = { name: 'today' };     // the screen behind the item panel
let shownMain = '';                // which main route is drawn now
let focusTitleOf = null;           // a new page whose title gets the cursor

function parse(hash = location.hash) {
  const h = hash || '#today';
  let m;
  if ((m = /^#p\/([\w-]+)$/.exec(h))) return { name: 'page', id: m[1] };
  if ((m = /^#r\/([\w-]+)$/.exec(h))) return { name: 'record', id: m[1] };
  if ((m = /^#v\/([\w-]+)$/.exec(h))) return { name: 'view', id: m[1] };
  const name = h.slice(1);
  return SCREEN_OF[name] ? { name } : { name: 'today' };
}

const hashOf = (r) => (r.id ? '#' + { page: 'p', view: 'v', record: 'r' }[r.name] + '/' + r.id : '#' + r.name);

// ---------------------------------------------------------------- screens

function show() {
  closeMenu();
  const route = parse();
  if (route.name === 'record') {
    if (!shownMain) showMain(main);
    openPanel(route.id);
  } else {
    closePanel();
    main = route;
    showMain(route);
  }
  chrome();
}

function showMain(route) {
  const key = hashOf(route);
  const screen = SCREEN_OF[route.name];
  if (shownMain === key && route.name !== 'ask') return;
  if (currentPage() && !(route.name === 'page' && route.id === currentPage())) closePage();
  shownMain = key;
  for (const el of $$('.screen')) el.hidden = el.id !== 'screen-' + screen;
  if (route.name === 'page') {
    const f = focusTitleOf === route.id;
    focusTitleOf = null;
    openPage(route.id, { focusTitle: f });
  } else if (route.name === 'view') renderView($('#viewView'), route.id);
  else if (route.name === 'pages' || route.name === 'search') {
    if (route.name === 'pages') $('#searchInput').value = '';
    renderTree($('#pagesList'), true);
    renderSearch();
    if (route.name === 'search') setTimeout(() => $('#searchInput').focus(), 30);
  }
  else if (route.name === 'settings') renderSettings();
  else renderHome();
  if (route.name === 'ask') {
    setTimeout(() => { $('#askCard').scrollIntoView({ block: 'center' }); $('#askText').focus(); }, 30);
  } else {
    $('#main').scrollTop = 0;
    window.scrollTo(0, 0);
  }
}

function openPanel(id) {
  const panel = $('#panel');
  panel.hidden = false;
  document.body.classList.add('panel-open');
  openRecord(id);
}

function closePanel() {
  if ($('#panel').hidden) return;
  closeRecord();
  $('#panel').hidden = true;
  document.body.classList.remove('panel-open');
}

// The top bar (phone), tab bar, sidebar highlights and sync status.
function chrome() {
  const route = parse();
  const at = route.name === 'record' ? main : route;
  const home = at.name === 'today' || at.name === 'ask';
  const tabRoot = home || at.name === 'pages' || at.name === 'search';
  $('#brand').hidden = !home;
  $('#backBtn').hidden = tabRoot;
  const tt = $('#topTitle');
  tt.hidden = home;
  tt.textContent = titleFor(at);
  $('#settingsBtn').hidden = !(home || at.name === 'settings');
  $('#settingsBtn').setAttribute('aria-pressed', String(at.name === 'settings'));
  document.title = home ? 'Dashboard' : titleFor(at) + ' · Dashboard';

  const tab = at.name === 'ask' ? 'ask' : home ? 'today' : (at.name === 'search' || at.name === 'page' || at.name === 'pages' || at.name === 'view') ? 'pages' : '';
  for (const b of $$('#tabbar .tab')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const b of $$('#sidebar [data-go]')) b.classList.toggle('on', b.dataset.go === hashOf(at) || (b.dataset.go === '#today' && at.name === 'today'));
  for (const a of $$('#pageTree .t-row')) a.classList.toggle('on', at.name === 'page' && a.dataset.id === at.id);
  renderSync();
}

function titleFor(r) {
  if (r.name === 'page') return titleOf(get(r.id)) || 'Page';
  if (r.name === 'view') return titleOf(get(r.id)) || 'View';
  return { pages: 'Pages', search: 'Pages', settings: 'Settings' }[r.name] || 'Dashboard';
}

// Where the phone's back button goes: one step up, not browser history.
function back() {
  const r = parse();
  if (r.name === 'record') { location.hash = hashOf(main); return; }
  if (r.name === 'page') {
    const p = get(r.id);
    location.hash = p && p.parent && get(p.parent) ? '#p/' + p.parent : '#pages';
    return;
  }
  if (r.name === 'view') {
    const v = get(r.id);
    location.hash = v && v.page && get(v.page) ? '#p/' + v.page : '#today';
    return;
  }
  location.hash = '#today';
}

function renderSync() {
  const s = isDataConnected() ? sync.state : 'local';
  const label = { local: 'On this device only', syncing: 'Syncing…', synced: 'Saved to Drive', offline: 'Offline, saved here', error: 'Sync problem' }[s];
  for (const el of [$('#sideSync'), $('#topSync')]) {
    el.className = 'sync s-' + s + (el.id === 'topSync' ? ' dot-only' : '');
    el.title = label + (s === 'error' && sync.error ? ': ' + sync.error : '');
    el.innerHTML = '<span class="dot"></span>' + (el.id === 'topSync' ? '' : '<span>' + esc(label) + '</span>');
  }
}

// ---------------------------------------------------------------- page tree

function uiState() {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { return {}; }
}
function setOpen(id, open) {
  const s = uiState();
  s.open = s.open || {};
  if (open) s.open[id] = 1; else delete s.open[id];
  localStorage.setItem(UI_KEY, JSON.stringify(s));
}

function renderTree(host, big) {
  const open = uiState().open || {};
  const current = main.name === 'page' ? main.id : '';
  const row = (p, depth) => {
    const kids = childPages(p.id);
    const isOpen = !!open[p.id];
    return '<div class="t-item">' +
      '<div class="t-row' + (p.id === current ? ' on' : '') + '" data-id="' + esc(p.id) + '" style="--depth:' + depth + '">' +
        (kids.length ? '<button type="button" class="t-tog' + (isOpen ? ' open' : '') + '" data-toggle="' + esc(p.id) + '" aria-label="' + (isOpen ? 'Close' : 'Open') + '" aria-expanded="' + isOpen + '">' + icon('chevron') + '</button>' : '<span class="t-tog none"></span>') +
        '<a class="t-link" href="#p/' + esc(p.id) + '">' + icon('page') + '<span class="t-title">' + esc(titleOf(p)) + '</span></a>' +
        '<button type="button" class="t-add" data-add-in="' + esc(p.id) + '" aria-label="New page inside" title="New page inside">' + icon('plus') + '</button>' +
      '</div>' +
      (kids.length && isOpen ? kids.map((k) => row(k, depth + 1)).join('') : '') +
      '</div>';
  };
  const tops = topPages();
  host.innerHTML = tops.length ? tops.map((p) => row(p, 0)).join('')
    : '<p class="muted small t-empty">No pages yet.' + (big ? '' : ' <button type="button" class="link" data-new-page>Make one</button>') + '</p>';
}

function treeClick(e) {
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    const id = tog.dataset.toggle;
    setOpen(id, !tog.classList.contains('open'));
    renderTree(e.currentTarget, e.currentTarget.id === 'pagesList');
    return;
  }
  const add = e.target.closest('[data-add-in]');
  if (add) { setOpen(add.dataset.addIn, true); makePage(add.dataset.addIn); }
}

function makePage(parent = null) {
  flushPage();
  const p = newPage({ parent });
  focusTitleOf = p.id;
  location.hash = '#p/' + p.id;
}

// Opens the tree down to the page being shown.
function revealInTree(id) {
  let p = get(id);
  const seen = new Set();
  while (p && p.parent && !seen.has(p.parent)) { seen.add(p.parent); setOpen(p.parent, true); p = get(p.parent); }
}

// ---------------------------------------------------------------- search

function renderSearch() {
  const q = $('#searchInput').value;
  const hits = search(q);
  const out = $('#searchResults');
  const empty = !q.trim();
  out.hidden = empty;
  $('#pagesAll').hidden = !empty;
  if (empty) { out.innerHTML = ''; return; }
  out.innerHTML = hits.length ? list(hits) : '<p class="muted">Nothing found for “' + esc(q) + '”.</p>';
}

function list(hits) {
  return '<ul class="hits">' + hits.map((h) => {
    const it = h.item;
    const href = (it.kind === 'page' ? '#p/' : it.kind === 'view' ? '#v/' : '#r/') + esc(it.id);
    return '<li><a href="' + href + '">' + icon(it.kind === 'page' ? 'page' : 'link') +
      '<span class="h-main"><span class="h-title">' + esc(titleOf(it)) + '</span>' +
      (h.snippet ? '<span class="h-snip muted small">' + esc(h.snippet) + '</span>' : '') + '</span></a></li>';
  }).join('') + '</ul>';
}

// ---------------------------------------------------------------- start

let treeTimer = null;
function onData() {
  clearTimeout(treeTimer);
  treeTimer = setTimeout(() => {
    renderTree($('#pageTree'), false);
    if (!$('#screen-pages').hidden) { renderTree($('#pagesList'), true); renderSearch(); }
    if (!$('#screen-view').hidden && main.name === 'view') renderView($('#viewView'), main.id);
    chrome();
  }, 60);
}

function init() {
  fillIcons();
  if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')) $('#searchKbd').textContent = 'Ctrl K';

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { location.hash = go.dataset.go; return; }
    if (e.target.closest('[data-new-page]')) makePage(null);
  });
  $('#settingsBtn').addEventListener('click', () => {
    location.hash = parse().name === 'settings' ? '#today' : '#settings';
  });
  $('#brand').addEventListener('click', () => { location.hash = '#today'; });
  $('#sideBrand').addEventListener('click', () => { location.hash = '#today'; });
  $('#backBtn').addEventListener('click', back);
  $('#sideNewPage').addEventListener('click', () => makePage(null));
  $('#pagesNew').addEventListener('click', () => makePage(null));
  $('#pageTree').addEventListener('click', treeClick);
  $('#pagesList').addEventListener('click', treeClick);
  $('#searchInput').addEventListener('input', renderSearch);
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = $('#searchResults a'); if (a) location.hash = a.getAttribute('href'); }
    if (e.key === 'Escape') { e.target.value = ''; renderSearch(); e.target.blur(); }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); location.hash = '#search'; setTimeout(() => $('#searchInput').select(), 40); }
    if (e.key === 'Escape' && !menuOpen() && !$('#panel').hidden) {
      const a = document.activeElement;
      if (!a || !$('#panel').contains(a) || !(a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName))) location.hash = hashOf(main);
    }
  });
  document.addEventListener('dashboard:closepanel', () => { location.hash = hashOf(main); });
  // clicking the dimmed area beside the panel (phone and tablet) closes it
  $('#panel').addEventListener('click', (e) => { if (e.target === $('#panel')) location.hash = hashOf(main); });
  document.addEventListener('dashboard:data', onData);
  document.addEventListener('dashboard:sync', renderSync);
  window.addEventListener('hashchange', () => {
    const r = parse();
    if (r.name === 'page') revealInTree(r.id);
    show();
  });

  initHome();
  initSettings();
  initEditor();
  initRecord();
  registerServiceWorker();
  loadData().then(() => {
    const r = parse();
    if (r.name === 'page') revealInTree(r.id);
    renderTree($('#pageTree'), false);
    show();
    startSync();
  });
}

init();
