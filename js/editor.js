// The page editor: a title and a column of blocks, edited in place.
//
// Typing works like Notion: Enter makes a new block, Backspace at the start
// joins with the block above, "# " makes a heading, "- " a list, "[] " a
// to-do, "> " a quote, "---" a line, and "/" opens a menu of block types,
// sub-pages and views. Pasting several lines makes several blocks.
//
// The page is saved as one item (title + blocks) shortly after each change.
// Changes from elsewhere (another device, Claude) are shown when the page is
// not being typed in; while typing, they wait until the cursor leaves.

import * as data from './data.js';
import { BLOCKS, TEXT_BLOCKS, LIST_BLOCKS, ARCHETYPES, newBlock, newPage, newView, childPages, ancestors, descendants,
  types, backlinks, topPages, titleOf } from './model.js';
import { renderView } from './views.js';
import { $, $$, esc, icon, caretOffset, setCaret, editableText, EDITABLE, openMenu, closeMenu, menuKey, menuOpen,
  hasSelection, toast } from './ui.js';

let pageId = null;
let blocks = [];
let title = '';
let lastWritten = 0;
let saveTimer = null;
let remoteWaiting = false;
let slash = null;            // { id, start } while the "/" menu is open
let writing = false;         // true while our own save is going through

const clone = (x) => JSON.parse(JSON.stringify(x));
const PH = { text: 'Write, or type / for blocks', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
  bullet: 'List', number: 'List', todo: 'To-do', quote: 'Quote', callout: 'Something to notice', code: 'Code' };
const MD = [
  [/^#\s/, 'h1'], [/^##\s/, 'h2'], [/^###\s/, 'h3'], [/^[-*•]\s/, 'bullet'], [/^1[.)]\s/, 'number'],
  [/^\[\s?\]\s/, 'todo'], [/^\[x\]\s/i, 'todo', true], [/^>\s/, 'quote'], [/^!\s/, 'callout'],
];

// ---------------------------------------------------------------- public

export function initEditor() {
  const root = $('#pageView');
  root.addEventListener('input', onInput);
  root.addEventListener('keydown', onKeydown);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('paste', onPaste);
  root.addEventListener('focusout', () => setTimeout(() => {
    if (remoteWaiting && !editing() && pageId && data.get(pageId) && !saveTimer) { remoteWaiting = false; load(); render(); }
  }, 0));
  document.addEventListener('dashboard:data', onData);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

export function openPage(id, { focusTitle } = {}) {
  flush();
  closeMenu();
  pageId = id;
  remoteWaiting = false;
  if (!data.get(id)) { renderMissing(); return; }
  load();
  render();
  if (focusTitle) setCaret($('#pageView .page-title'), 0);
}

export function closePage() { flush(); pageId = null; }
export function currentPage() { return pageId; }

export function flush() {
  if (saveTimer) { clearTimeout(saveTimer); save(); }
}

// ---------------------------------------------------------------- state

function load() {
  const p = data.get(pageId);
  blocks = clone(p.blocks || []);
  if (!blocks.length) blocks = [newBlock()];
  title = p.title || '';
  lastWritten = p.updatedAt;
}

function save() {
  saveTimer = null;
  if (!pageId || !data.get(pageId)) return;
  writing = true;
  try {
    const saved = data.patch(pageId, { title, blocks: clone(blocks) });
    if (saved) lastWritten = saved.updatedAt;
  } finally {
    writing = false;
  }
  refreshEmbeds();
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function editing() {
  const a = document.activeElement;
  return !!(a && $('#pageView').contains(a) && a.isContentEditable);
}

function onData() {
  if (writing || !pageId || $('#screen-page').hidden) return;
  const p = data.get(pageId);
  if (!p) { renderMissing(); return; }
  if (p.updatedAt !== lastWritten && !saveTimer) {
    if (editing()) remoteWaiting = true;
    else { load(); render(); return; }
  }
  refreshEmbeds();
}

const indexOf = (id) => blocks.findIndex((b) => b.id === id);
const blockEl = (id) => $('#pageView .block[data-id="' + CSS.escape(id) + '"]');
const textEl = (id) => { const b = blockEl(id); return b && b.querySelector('.bt'); };

// ---------------------------------------------------------------- drawing

function renderMissing() {
  $('#pageCrumbs').innerHTML = '';
  $('#pageView').innerHTML = '<p class="muted">This page was deleted or is not on this device yet.</p><p><a href="#today">Back to Today</a></p>';
}

function render(focus) {
  const p = data.get(pageId);
  const trail = ancestors(p);
  $('#pageCrumbs').innerHTML = trail.map((a) => '<a href="#p/' + esc(a.id) + '">' + esc(titleOf(a)) + '</a><span class="sep">/</span>').join('') +
    '<span class="here">' + esc(title || 'Untitled') + '</span>';

  let n = 0;
  const html = blocks.map((b, i) => {
    n = b.type === 'number' ? (blocks[i - 1] && blocks[i - 1].type === 'number' ? n + 1 : 1) : 0;
    return blockHTML(b, n);
  }).join('');
  const only = blocks.length === 1 && TEXT_BLOCKS.has(blocks[0].type) && !blocks[0].text;

  $('#pageView').innerHTML =
    '<header class="page-head">' +
      '<h1 class="page-title" contenteditable="' + EDITABLE + '" data-ph="Untitled" spellcheck="true">' + esc(title) + '</h1>' +
      '<button type="button" class="iconbtn" data-page-menu aria-label="Page options">' + icon('more') + '</button>' +
    '</header>' +
    '<div class="blocks' + (only ? ' only' : '') + '">' + html + '</div>' +
    '<button type="button" class="page-tail" data-tail aria-label="Add a block"></button>' +
    '<section class="page-foot"></section>';
  refreshEmbeds();
  if (focus) focusBlock(focus.id, focus.at);
}

function blockHTML(b, n) {
  const handle = '<div class="bhandle"><button type="button" class="bh" data-bmenu="' + esc(b.id) + '" aria-label="Block options" tabindex="-1">' + icon('grip') + '</button></div>';
  const open = '<div class="block b-' + esc(b.type) + (b.checked ? ' done' : '') + '" data-id="' + esc(b.id) + '">' + handle;
  if (b.type === 'divider') return open + '<hr></div>';
  if (b.type === 'view') return open + '<div class="view-host" data-view-host="' + esc(b.view) + '"></div></div>';
  if (b.type === 'page') return open + '<a class="pagelink" href="#p/' + esc(b.ref) + '" data-ref="' + esc(b.ref) + '">' + icon('page') + '<span></span></a></div>';
  if (b.type === 'record') return open + '<a class="pagelink rec" href="#r/' + esc(b.ref) + '" data-ref="' + esc(b.ref) + '">' + icon('link') + '<span></span></a></div>';
  let marker = '';
  if (b.type === 'bullet') marker = '<span class="marker" aria-hidden="true">•</span>';
  else if (b.type === 'number') marker = '<span class="marker" aria-hidden="true">' + n + '.</span>';
  else if (b.type === 'todo') marker = '<input type="checkbox" class="marker" data-todo' + (b.checked ? ' checked' : '') + ' aria-label="Done">';
  const type = TEXT_BLOCKS.has(b.type) ? b.type : 'text';
  return open + marker + '<div class="bt" contenteditable="' + EDITABLE + '" data-ph="' + esc(PH[type]) + '" spellcheck="' + (type === 'code' ? 'false' : 'true') + '">' + esc(b.text || '') + '</div></div>';
}

// Views, links to pages and records, sub-pages and backlinks: drawn from the
// current data each time something changes.
function refreshEmbeds() {
  const root = $('#pageView');
  if (!pageId || !root.querySelector('.page-head')) return;
  for (const host of $$('[data-view-host]', root)) renderView(host, host.dataset.viewHost);
  for (const a of $$('.pagelink', root)) {
    const it = data.get(a.dataset.ref);
    a.querySelector('span').textContent = it ? titleOf(it) : 'Removed';
    a.classList.toggle('gone', !it);
  }
  const linked = new Set(blocks.filter((b) => b.type === 'page').map((b) => b.ref));
  const subs = childPages(pageId).filter((c) => !linked.has(c.id));
  const back = backlinks(pageId).filter((x) => !(x.item.kind === 'page' && x.item.id === pageId));
  const foot = $('.page-foot', root);
  if (!foot) return;
  foot.innerHTML =
    (subs.length ? '<h2>Pages inside</h2><ul class="plinks">' + subs.map((c) => '<li><a href="#p/' + esc(c.id) + '">' + icon('page') + esc(titleOf(c)) + '</a></li>').join('') + '</ul>' : '') +
    (back.length ? '<h2>Linked here</h2><ul class="plinks">' + back.map((x) => '<li><a href="' + (x.item.kind === 'page' ? '#p/' : '#r/') + esc(x.item.id) + '">' +
      icon(x.item.kind === 'page' ? 'page' : 'link') + esc(titleOf(x.item)) + '</a></li>').join('') + '</ul>' : '');
}

function focusBlock(id, at = 0) {
  const el = textEl(id);
  if (el) { setCaret(el, at === 'end' ? editableText(el).length : at); el.scrollIntoView({ block: 'nearest' }); return true; }
  return false;
}

function focusNeighbour(i, dir, at) {
  for (let j = i + dir; j >= 0 && j < blocks.length; j += dir) {
    if (TEXT_BLOCKS.has(blocks[j].type)) return focusBlock(blocks[j].id, at);
  }
  return false;
}

// ---------------------------------------------------------------- typing

function onInput(e) {
  const t = e.target;
  if (t.classList.contains('page-title')) {
    title = editableText(t).replace(/\n/g, ' ');
    $('#pageCrumbs .here') && ($('#pageCrumbs .here').textContent = title || 'Untitled');
    for (const el of $$('.t-row[data-id="' + CSS.escape(pageId) + '"] .t-title')) el.textContent = title || 'Untitled';
    if (!$('#topTitle').hidden) $('#topTitle').textContent = title || 'Untitled';
    saveSoon();
    return;
  }
  if (!t.classList.contains('bt')) return;
  const id = t.closest('.block').dataset.id;
  const b = blocks[indexOf(id)];
  if (!b) return;
  b.text = editableText(t);
  $('#pageView .blocks').classList.remove('only');

  // markdown shortcuts at the start of a plain text block
  if (b.type === 'text' || (b.type !== 'code' && /^(#{1,3}\s)/.test(b.text))) {
    if (b.text === '---' || b.text === '***') { toDivider(b); return; }
    if (b.text === '```') { b.type = 'code'; b.text = ''; saveSoon(); render({ id, at: 0 }); return; }
    for (const [re, type, checked] of MD) {
      const m = re.exec(b.text);
      if (m && (b.type === 'text' || /^h/.test(type))) {
        b.type = type;
        b.text = b.text.slice(m[0].length);
        if (type === 'todo') b.checked = !!checked;
        saveSoon();
        render({ id, at: 0 });
        return;
      }
    }
  }

  // the "/" menu
  const at = caretOffset(t);
  if (slash && slash.id === id) {
    const q = b.text.slice(slash.start + 1, at);
    if (at <= slash.start || /\s/.test(q) || b.text[slash.start] !== '/') { slash = null; closeMenu(); }
    else showSlash(t, q);
  } else if (e.inputType === 'insertText' && e.data === '/' && b.type !== 'code') {
    const before = b.text[at - 2];
    if (at === 1 || before === ' ' || before === '\n' || before === undefined) {
      slash = { id, start: at - 1 };
      showSlash(t, '');
    }
  }
  saveSoon();
}

function onKeydown(e) {
  if (menuOpen() && slash && menuKey(e)) { e.preventDefault(); return; }
  const t = e.target;
  if (t.classList.contains('page-title')) {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!blocks.length || !TEXT_BLOCKS.has(blocks[0].type)) { blocks.unshift(newBlock()); saveSoon(); render({ id: blocks[0].id, at: 0 }); }
      else focusBlock(blocks[0].id, 0);
    }
    return;
  }
  if (!t.classList.contains('bt') || e.isComposing) return;
  const id = t.closest('.block').dataset.id;
  const i = indexOf(id);
  const b = blocks[i];
  const at = caretOffset(t);
  const text = editableText(t);

  if (e.key === 'Enter' && !e.shiftKey && b.type !== 'code') {
    e.preventDefault();
    b.text = text;
    if (LIST_BLOCKS.has(b.type) && !text) { b.type = 'text'; delete b.checked; saveSoon(); render({ id, at: 0 }); return; }
    const nextType = LIST_BLOCKS.has(b.type) ? b.type : 'text';
    const nb = newBlock(nextType, text.slice(at));
    b.text = text.slice(0, at);
    blocks.splice(i + 1, 0, nb);
    saveSoon();
    render({ id: nb.id, at: 0 });
    return;
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && b.type === 'code') {
    e.preventDefault();
    const nb = newBlock();
    blocks.splice(i + 1, 0, nb);
    saveSoon();
    render({ id: nb.id, at: 0 });
    return;
  }
  if (e.key === 'Backspace' && at === 0 && !hasSelection(t)) {
    if (b.type !== 'text') {
      e.preventDefault();
      b.type = 'text'; delete b.checked; b.text = text;
      saveSoon(); render({ id, at: 0 });
      return;
    }
    const prev = blocks[i - 1];
    if (prev && TEXT_BLOCKS.has(prev.type)) {
      e.preventDefault();
      const join = (prev.text || '').length;
      prev.text = (prev.text || '') + text;
      blocks.splice(i, 1);
      saveSoon(); render({ id: prev.id, at: join });
      return;
    }
    if (!text && blocks.length > 1) {
      e.preventDefault();
      blocks.splice(i, 1);
      saveSoon();
      render();
      if (!focusNeighbour(i, -1, 'end')) focusNeighbour(i - 1, 1, 0);
      return;
    }
  }
  if (e.key === 'Delete' && at === text.length && !hasSelection(t)) {
    const next = blocks[i + 1];
    if (next && TEXT_BLOCKS.has(next.type)) {
      e.preventDefault();
      b.text = text + (next.text || '');
      blocks.splice(i + 1, 1);
      saveSoon(); render({ id, at: text.length });
      return;
    }
  }
  if (e.key === 'ArrowUp' && onEdgeLine(t, -1)) { if (focusNeighbour(i, -1, 'end')) e.preventDefault(); return; }
  if (e.key === 'ArrowDown' && onEdgeLine(t, 1)) { if (focusNeighbour(i, 1, 0)) e.preventDefault(); return; }
  if (e.key === 'Escape') { t.blur(); }
}

// True when the caret is on the first (dir -1) or last (dir 1) line of el.
function onEdgeLine(el, dir) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return true;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(true);
  let rect = r.getClientRects()[0];
  const box = el.getBoundingClientRect();
  if (!rect) return true;
  const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
  return dir < 0 ? rect.top - box.top < line * 0.8 : box.bottom - rect.bottom < line * 0.8;
}

function toDivider(b) {
  const i = indexOf(b.id);
  b.type = 'divider'; b.text = '';
  const nb = newBlock();
  blocks.splice(i + 1, 0, nb);
  saveSoon();
  render({ id: nb.id, at: 0 });
}

function onPaste(e) {
  const t = e.target;
  if (!t.classList || !t.classList.contains('bt')) return;
  const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
  const id = t.closest('.block').dataset.id;
  const i = indexOf(id);
  const b = blocks[i];
  if (!text.includes('\n') || b.type === 'code') {
    if (EDITABLE !== 'plaintext-only') {   // keep pasted text plain
      e.preventDefault();
      document.execCommand('insertText', false, text);
    }
    return;
  }
  e.preventDefault();
  const at = caretOffset(t);
  const cur = editableText(t);
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const tail = cur.slice(at);
  b.text = cur.slice(0, at) + lines[0];
  const made = lines.slice(1).map((line) => lineToBlock(line));
  blocks.splice(i + 1, 0, ...made);
  const last = made[made.length - 1] || b;
  const end = (last.text || '').length;
  last.text = (last.text || '') + tail;
  saveSoon();
  render({ id: last.id, at: end });
}

function lineToBlock(line) {
  if (/^\s*(---|\*\*\*)\s*$/.test(line)) return { ...newBlock('divider'), text: '' };
  for (const [re, type, checked] of [[/^###\s/, 'h3'], [/^##\s/, 'h2'], ...MD]) {
    const m = re.exec(line.trimStart());
    if (m) { const nb = newBlock(type, line.trimStart().slice(m[0].length)); if (type === 'todo') nb.checked = !!checked; return nb; }
  }
  const m = /^\s*\d+[.)]\s/.exec(line);
  if (m) return newBlock('number', line.slice(m[0].length));
  return newBlock('text', line);
}

// ---------------------------------------------------------------- clicks

function onClick(e) {
  const bm = e.target.closest('[data-bmenu]');
  if (bm) { blockMenu(bm, bm.dataset.bmenu); return; }
  if (e.target.closest('[data-page-menu]')) { pageMenu(e.target.closest('[data-page-menu]')); return; }
  if (e.target.closest('[data-tail]')) {
    const last = blocks[blocks.length - 1];
    if (last && TEXT_BLOCKS.has(last.type) && !last.text) { focusBlock(last.id, 0); return; }
    const nb = newBlock();
    blocks.push(nb);
    saveSoon();
    render({ id: nb.id, at: 0 });
  }
}

function onChange(e) {
  if (!e.target.matches('[data-todo]')) return;
  const id = e.target.closest('.block').dataset.id;
  const b = blocks[indexOf(id)];
  b.checked = e.target.checked;
  blockEl(id).classList.toggle('done', b.checked);
  saveSoon();
}

// ---------------------------------------------------------------- menus

function showSlash(el, q) {
  const items = slashItems(q.toLowerCase());
  openMenu(el.closest('.block'), items, { onClose: () => { slash = null; } });
}

function slashItems(q) {
  const match = (s) => !q || s.toLowerCase().includes(q);
  const out = [];
  const blockItems = BLOCKS.filter((x) => match(x.label) || match(x.type)).map((x) => ({
    label: x.label, hint: x.md.trim() || '', icon: { text: '¶', h1: 'H1', h2: 'H2', h3: 'H3', bullet: '•', number: '1.', todo: '☐', quote: '❝', callout: '!', code: '{}', divider: '—' }[x.type],
    action: () => applySlash((b) => { if (x.type === 'divider') { toDivider(b); return 'done'; } b.type = x.type; if (x.type === 'todo') b.checked = false; }),
  }));
  if (blockItems.length) out.push({ heading: 'Blocks' }, ...blockItems);
  if (match('page') || match('sub-page')) {
    out.push({ heading: 'Pages' }, { label: 'Page inside this one', icon: '📄', action: () => applySlash((b, i) => {
      const sp = newPage({ title: '', parent: pageId });
      if (!b.text) { b.type = 'page'; b.ref = sp.id; delete b.text; } else blocks.splice(i + 1, 0, { id: newBlock().id, type: 'page', ref: sp.id });
      save();
      location.hash = '#p/' + sp.id;
      return 'done';
    }) });
  }
  const ts = types();
  const viewItems = [];
  for (const t of ts) {
    for (const a of ARCHETYPES) {
      const label = a.label + ' of ' + (t.plural || t.name);
      if (match(label) || match('view')) viewItems.push({ label, icon: a.icon, action: () => applySlash((b, i) => {
        const v = newView({ title: t.plural || t.name, archetype: a.key, type: t.id, page: pageId });
        const vb = { id: newBlock().id, type: 'view', view: v.id };
        if (!b.text) blocks.splice(i, 1, vb); else blocks.splice(i + 1, 0, vb);
        if (!blocks[blocks.indexOf(vb) + 1]) blocks.push(newBlock());
        save();
        render({ id: blocks[blocks.indexOf(vb) + 1].id, at: 0 });
        return 'done';
      }) });
    }
  }
  if (viewItems.length) out.push({ heading: 'Views of your items' }, ...viewItems.slice(0, 30));
  else if (match('view') || match('table') || match('board')) out.push({ heading: 'Views' }, { label: 'No kinds of items yet', hint: 'Claude makes these', icon: '…', action: () => {} });
  return out;
}

// Removes the "/query" text, then lets fn change the block.
function applySlash(fn) {
  if (!slash) return;
  const i = indexOf(slash.id);
  const b = blocks[i];
  const el = textEl(slash.id);
  const at = el ? caretOffset(el) : -1;
  const end = at > slash.start ? at : slash.start + 1;
  b.text = (b.text || '').slice(0, slash.start) + (b.text || '').slice(end);
  const keep = slash.start;
  slash = null;
  const r = fn(b, i);
  if (r === 'done') return;
  saveSoon();
  render({ id: b.id, at: keep });
}

function blockMenu(anchor, id) {
  const i = indexOf(id);
  const b = blocks[i];
  if (!b) return;
  const items = [];
  if (TEXT_BLOCKS.has(b.type)) {
    items.push({ heading: 'Turn into' });
    for (const x of BLOCKS.filter((x) => x.type !== 'divider' && x.type !== b.type)) {
      items.push({ label: x.label, action: () => { b.type = x.type; if (x.type !== 'todo') delete b.checked; saveSoon(); render({ id, at: 'end' }); } });
    }
    items.push({ heading: '' });
  }
  if (b.type === 'view') items.push({ label: 'Open view', icon: '↗', action: () => { location.hash = '#v/' + b.view; } });
  if (i > 0) items.push({ label: 'Move up', icon: '↑', action: () => { blocks.splice(i - 1, 0, blocks.splice(i, 1)[0]); saveSoon(); render({ id, at: 'end' }); } });
  if (i < blocks.length - 1) items.push({ label: 'Move down', icon: '↓', action: () => { blocks.splice(i + 1, 0, blocks.splice(i, 1)[0]); saveSoon(); render({ id, at: 'end' }); } });
  if (TEXT_BLOCKS.has(b.type) || b.type === 'divider') items.push({ label: 'Duplicate', icon: '⧉', action: () => { const c = { ...clone(b), id: newBlock().id }; blocks.splice(i + 1, 0, c); saveSoon(); render({ id: c.id, at: 'end' }); } });
  items.push({ label: 'Delete', icon: '🗑', danger: true, action: () => {
    const removed = blocks.splice(i, 1)[0];
    if (!blocks.length) blocks.push(newBlock());
    let removedView = null;
    if (removed.type === 'view') {
      const v = data.get(removed.view);
      if (v && v.page === pageId) { removedView = clone(v); data.remove(v.id); }
    }
    save();
    render();
    toast('Block deleted.', { label: 'Undo', run: () => {
      if (removedView) data.put(removedView);
      blocks.splice(Math.min(i, blocks.length), 0, removed);
      save(); render();
    } });
  } });
  openMenu(anchor, items);
}

function pageMenu(anchor) {
  const p = data.get(pageId);
  if (!p) return;
  const items = [
    { label: p.pinned ? 'Unpin from Today' : 'Pin to Today', icon: '📌', action: () => { flush(); data.patch(pageId, { pinned: !p.pinned }); } },
    { label: 'New page inside', icon: '📄', action: () => { flush(); const sp = newPage({ parent: pageId }); location.hash = '#p/' + sp.id; } },
    { label: 'Move to…', icon: '↪', action: () => moveMenu(anchor) },
    { heading: '' },
    { label: 'Delete page', icon: '🗑', danger: true, action: deletePage },
  ];
  openMenu(anchor, items);
}

function moveMenu(anchor) {
  const p = data.get(pageId);
  const banned = new Set([pageId, ...descendants(pageId).map((d) => d.id)]);
  const items = [{ heading: 'Move into' }];
  if (p.parent) items.push({ label: 'Top level', icon: '⌂', action: () => moveTo(null) });
  const walk = (list, depth) => {
    for (const x of list) {
      if (banned.has(x.id)) continue;
      items.push({ label: ' '.repeat(depth) + titleOf(x), icon: '📄', action: () => moveTo(x.id) });
      if (depth < 3) walk(childPages(x.id), depth + 1);
    }
  };
  walk(topPages(), 0);
  openMenu(anchor, items);
}

function moveTo(parent) {
  flush();
  const siblings = childPages(parent);
  const order = siblings.length ? Math.max(...siblings.map((s) => s.order || 0)) + 1 : 1;
  data.patch(pageId, { parent, order });
  toast('Moved.');
}

export function deletePage() {
  flush();
  const p = data.get(pageId);
  if (!p) return;
  const subs = descendants(pageId);
  const ids = new Set([p.id, ...subs.map((s) => s.id)]);
  const msg = subs.length ? 'Delete “' + titleOf(p) + '” and the ' + subs.length + ' page' + (subs.length === 1 ? '' : 's') + ' inside it?' : 'Delete “' + titleOf(p) + '”?';
  if (!confirm(msg)) return;
  const before = [p, ...subs, ...data.all('view').filter((v) => ids.has(v.page))].map(clone);
  for (const it of before) data.remove(it.id);
  const parent = p.parent && data.get(p.parent);
  pageId = null;
  location.hash = parent ? '#p/' + parent.id : '#today';
  toast('Page deleted.', { label: 'Undo', run: () => { for (const it of before) data.put(it); location.hash = '#p/' + p.id; } });
}
