// Small helpers shared by the screens.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Escape text before putting it into innerHTML. Use it for every value that
// did not come from this file's own string literals.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clock(t) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayAndClock(t) {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? clock(t) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + clock(t);
}

export function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return dayAndClock(t);
}

// Only http(s) links may become <a href>, so a stored value can never run code.
export function safeHref(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch (e) {
    return '';
  }
}

export const isDesktop = () => typeof matchMedia === 'function' && matchMedia('(min-width: 900px)').matches;

// ---------------------------------------------------------------- icons
// Fixed SVG strings (no data in them), so they are safe for innerHTML.

const ICONS = {
  picture: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  pages: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/></svg>',
  ask: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/></svg>',
  page: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 3H6l4-3z"/><path d="M12 13v7"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  claude: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/></svg>',
};

export function icon(name) {
  return '<span class="ico" aria-hidden="true">' + (ICONS[name] || '') + '</span>';
}

// Fills every <span class="ico" data-icon="name"> in the page.
export function fillIcons(root = document) {
  for (const el of root.querySelectorAll('.ico[data-icon]')) {
    if (!el.firstChild) el.innerHTML = ICONS[el.dataset.icon] || '';
  }
}

// ---------------------------------------------------------------- caret
// For plain-text editable blocks: the caret position as a character offset.

export function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return -1;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(el);
  r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length;
}

export function hasSelection(el) {
  const sel = window.getSelection();
  return !!(sel && sel.rangeCount && !sel.isCollapsed && el.contains(sel.anchorNode));
}

export function setCaret(el, offset) {
  el.focus();
  const sel = window.getSelection();
  const r = document.createRange();
  let left = Math.max(0, offset);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  if (!node) { r.setStart(el, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return; }
  while (node) {
    if (left <= node.length) { r.setStart(node, left); break; }
    left -= node.length;
    const next = walker.nextNode();
    if (!next) { r.setStart(node, node.length); break; }
    node = next;
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// The text of an editable block, without the stray newline browsers add.
export function editableText(el) {
  const t = el.innerText ?? el.textContent ?? '';
  return t === '\n' ? '' : t.replace(/\n$/, '');
}

// Plain-text editing where the browser has it, so pasted formatting is dropped.
export const EDITABLE = (() => {
  try {
    const d = document.createElement('div');
    d.contentEditable = 'plaintext-only';
    return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true';
  } catch (e) { return 'true'; }
})();

// ---------------------------------------------------------------- menu
// A small pop-up list. items: [{ label, hint, icon, danger, action }] or
// { heading } rows. Returns a controller for keyboard handling.

let menuState = null;

export function openMenu(anchor, items, { onClose, at } = {}) {
  closeMenu(true);
  const el = $('#menu');
  const pickable = items.filter((i) => !i.heading);
  el.innerHTML = items.map((i) => i.heading
    ? '<div class="menu-head">' + esc(i.heading) + '</div>'
    : '<button type="button" class="menu-item' + (i.danger ? ' danger' : '') + '" data-i="' + pickable.indexOf(i) + '">' +
      (i.icon ? '<span class="mi-ico">' + esc(i.icon) + '</span>' : '') +
      '<span class="mi-label">' + esc(i.label) + '</span>' +
      (i.hint ? '<span class="mi-hint">' + esc(i.hint) + '</span>' : '') + '</button>').join('') ||
    '<div class="menu-head">Nothing matches</div>';
  el.hidden = false;
  const box = (at || anchor.getBoundingClientRect());
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = Math.min(box.left, window.innerWidth - w - 8);
  let top = box.bottom + 4;
  if (top + h > window.innerHeight - 8) top = Math.max(8, box.top - h - 4);
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = top + 'px';
  menuState = { items: pickable, active: 0, onClose };
  highlight();
  el.onclick = (e) => {
    const b = e.target.closest('.menu-item');
    if (b) pick(Number(b.dataset.i));
  };
  el.onmousedown = (e) => e.preventDefault();   // keep the caret where it was
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  return menuState;
}

function outside(e) {
  if (!e.target.closest('#menu')) closeMenu();
}

function highlight() {
  if (!menuState) return;
  for (const b of $$('#menu .menu-item')) b.classList.toggle('active', Number(b.dataset.i) === menuState.active);
  const a = $('#menu .menu-item.active');
  if (a) a.scrollIntoView({ block: 'nearest' });
}

function pick(i) {
  const st = menuState;
  if (!st || !st.items[i]) return;
  closeMenu(true);        // picking is not cancelling: onClose is for cancel
  st.items[i].action();
}

export function menuOpen() { return !!menuState; }

// Arrow keys, Enter and Escape while a menu is open. Returns true if used.
export function menuKey(e) {
  if (!menuState) return false;
  const n = menuState.items.length;
  if (e.key === 'ArrowDown') { menuState.active = (menuState.active + 1) % Math.max(n, 1); highlight(); return true; }
  if (e.key === 'ArrowUp') { menuState.active = (menuState.active - 1 + n) % Math.max(n, 1); highlight(); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { if (n) pick(menuState.active); else closeMenu(); return true; }
  if (e.key === 'Escape') { closeMenu(); return true; }
  return false;
}

// replacing: true when another menu takes this one's place (no onClose then).
export function closeMenu(replacing = false) {
  const st = menuState;
  menuState = null;
  const el = $('#menu');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.removeEventListener('pointerdown', outside, true);
  if (st && st.onClose && replacing !== true) st.onClose();
}

// ---------------------------------------------------------------- toast

let toastTimer = null;
export function toast(text, action) {
  const el = $('#toast');
  el.innerHTML = '<span>' + esc(text) + '</span>' + (action ? '<button type="button" class="link">' + esc(action.label) + '</button>' : '');
  el.hidden = false;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2500);
}
