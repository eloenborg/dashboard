// One record (item), opened from a view, a search or a link. A side panel
// on a computer, a full-screen sheet on a phone. Shows every field of the
// item's type with an editor that fits the field type, its notes, what it
// links to and what links to it.

import * as data from './data.js';
import { typeOf, optionsOf, backlinks, titleOf, recordsOf } from './model.js';
import { $, esc, icon, timeAgo, safeHref, EDITABLE, editableText, toast, openMenu } from './ui.js';

let recordId = null;
let saveTimer = null;
let pending = null;

export function initRecord() {
  const body = $('#panelBody');
  body.addEventListener('input', onInput);
  body.addEventListener('change', onChange);
  body.addEventListener('click', onClick);
  body.addEventListener('keydown', (e) => {
    if (e.target.classList.contains('rec-title') && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
  document.addEventListener('dashboard:data', () => {
    if (!recordId || $('#panel').hidden) return;
    const a = document.activeElement;
    if (a && body.contains(a) && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName))) return;
    render();
  });
}

export function openRecord(id) {
  flush();
  recordId = id;
  render();
  const r = data.get(id);
  if (r && !r.title) setTimeout(() => $('#panelBody .rec-title') && $('#panelBody .rec-title').focus(), 30);
}

export function closeRecord() { flush(); recordId = null; }
export function currentRecord() { return recordId; }

function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; commit(); }
}

function change(fields) {
  pending = { ...(pending || {}), ...fields };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; commit(); }, 350);
}

function commit() {
  if (!pending || !recordId) return;
  const r = data.get(recordId);
  if (!r) return;
  const next = { ...pending };
  if (next.values) next.values = { ...(r.values || {}), ...next.values };
  pending = null;
  data.patch(recordId, next);
}

function render() {
  const r = data.get(recordId);
  const body = $('#panelBody');
  if (!r) {
    body.innerHTML = head('') + '<p class="muted pad">This item was deleted or is not on this device yet.</p>';
    return;
  }
  const t = typeOf(r);
  const fields = (t && t.fields) || [];
  const back = backlinks(r.id);
  const links = (r.links || []).map((l) => ({ l, it: data.get(l.to) })).filter((x) => x.it);
  body.innerHTML = head(t ? (t.name || 'Item') : (r.kind === 'record' ? 'Item' : titleOf(r))) +
    '<div class="rec">' +
      '<h2 class="rec-title" contenteditable="' + EDITABLE + '" data-ph="Untitled" spellcheck="true">' + esc(r.title || '') + '</h2>' +
      (fields.length ? '<dl class="props">' + fields.map((f) => '<div class="prop"><dt>' + esc(f.label || f.key) + '</dt><dd>' + editor(f, r.values ? r.values[f.key] : undefined) + '</dd></div>').join('') + '</dl>'
        : '<p class="muted small">No fields yet. Claude adds the fields this kind of item needs when it organizes your data.</p>') +
      '<label class="notes-label" for="recNotes">Notes</label>' +
      '<textarea id="recNotes" class="notes" rows="3" placeholder="Anything else about it">' + esc(r.notes || '') + '</textarea>' +
      (links.length ? '<h3>Links to</h3><ul class="plinks">' + links.map((x) => '<li><a href="' + hrefOf(x.it) + '">' + icon('link') + esc(titleOf(x.it)) + '</a>' + (x.l.rel ? ' <span class="muted small">' + esc(x.l.rel) + '</span>' : '') + '</li>').join('') + '</ul>' : '') +
      (back.length ? '<h3>Linked from</h3><ul class="plinks">' + back.map((x) => '<li><a href="' + hrefOf(x.item) + '">' + icon(x.item.kind === 'page' ? 'page' : 'link') + esc(titleOf(x.item)) + '</a> <span class="muted small">' + esc(x.why) + '</span></li>').join('') + '</ul>' : '') +
      '<p class="meta muted small">' + esc(made(r)) + '</p>' +
    '</div>';
}

function head(kind) {
  return '<header class="panel-head">' +
    '<button type="button" class="iconbtn" data-close aria-label="Close">' + icon('close') + '</button>' +
    '<span class="panel-kind">' + esc(kind) + '</span><div class="spacer"></div>' +
    '<button type="button" class="iconbtn" data-rec-menu aria-label="Item options">' + icon('more') + '</button>' +
    '</header>';
}

function hrefOf(it) { return (it.kind === 'page' ? '#p/' : it.kind === 'view' ? '#v/' : '#r/') + esc(it.id); }

function made(r) {
  const who = (x) => (x === 'claude' ? 'Claude' : 'you');
  const parts = [];
  if (r.createdAt) parts.push('Added by ' + who(r.createdBy || 'app') + ' ' + timeAgo(r.createdAt));
  if (r.updatedAt && r.updatedAt !== r.createdAt) parts.push('changed by ' + who(r.by || 'app') + ' ' + timeAgo(r.updatedAt));
  return parts.join(', ') + (parts.length ? '.' : '');
}

// An editor for one field. data-f holds the field key.
function editor(f, v) {
  const k = ' data-f="' + esc(f.key) + '"';
  const val = (x) => esc(x === undefined || x === null ? '' : x);
  switch (f.type) {
    case 'number': return '<input type="number" inputmode="decimal" step="any"' + k + ' value="' + val(v) + '">';
    case 'quantity': return '<span class="with-unit"><input type="number" inputmode="decimal" step="any"' + k + ' data-kind="quantity" value="' + val(v && typeof v === 'object' ? v.amount : v) + '">' + (f.unit ? '<span class="unit">' + esc(f.unit) + '</span>' : '') + '</span>';
    case 'money': {
      const amount = v && typeof v === 'object' ? v.amount : v;
      const cur = (v && typeof v === 'object' && v.currency) || f.currency || '';
      return '<span class="with-unit"><input type="number" inputmode="decimal" step="any"' + k + ' data-kind="money" data-currency="' + esc(cur) + '" value="' + val(amount) + '">' + (cur ? '<span class="unit">' + esc(cur) + '</span>' : '') + '</span>';
    }
    case 'date': return '<input type="date"' + k + ' value="' + val(v ? String(v).slice(0, 10) : '') + '">';
    case 'checkbox': return '<input type="checkbox"' + k + (v ? ' checked' : '') + '>';
    case 'rating': return '<span class="stars"' + k + '>' + [1, 2, 3, 4, 5].map((n) => '<button type="button" class="star' + (Number(v) >= n ? ' on' : '') + '" data-star="' + n + '" aria-label="' + n + ' of 5">★</button>').join('') + '</span>';
    case 'status': case 'select': {
      const opts = optionsOf(f);
      return '<select' + k + '><option value="">—</option>' + opts.map((o) => '<option value="' + esc(o.key) + '"' + (o.key === v ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') +
        (v && !opts.some((o) => o.key === v) ? '<option selected value="' + esc(v) + '">' + esc(v) + '</option>' : '') + '</select>';
    }
    case 'tags': return '<input type="text"' + k + ' data-kind="tags" value="' + esc((Array.isArray(v) ? v : v ? [v] : []).join(', ')) + '" placeholder="Comma, separated">';
    case 'url': case 'image': {
      const h = safeHref(v);
      return '<span class="with-unit"><input type="url" inputmode="url"' + k + ' value="' + val(v) + '" placeholder="https://…">' + (h ? '<a class="unit" href="' + esc(h) + '" target="_blank" rel="noopener" aria-label="Open">↗</a>' : '') + '</span>' +
        (f.type === 'image' && h ? '<img class="rec-img" src="' + esc(h) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '');
    }
    case 'link': {
      const ids = Array.isArray(v) ? v : v ? [v] : [];
      return '<span class="refs">' + ids.map((id) => data.get(id)).filter(Boolean).map((it) =>
        '<a class="ref" href="' + hrefOf(it) + '">' + esc(titleOf(it)) + '</a><button type="button" class="ref-x" data-unlink="' + esc(it.id) + '" data-field="' + esc(f.key) + '" aria-label="Remove link">×</button>').join('') +
        '<button type="button" class="ref-add" data-addlink="' + esc(f.key) + '">+ Link</button></span>';
    }
    default: return '<input type="text"' + k + ' value="' + val(v) + '">';
  }
}

function fieldOf(key) {
  const r = data.get(recordId);
  const t = typeOf(r);
  return ((t && t.fields) || []).find((f) => f.key === key);
}

function readInput(el) {
  const f = fieldOf(el.dataset.f);
  if (!f) return undefined;
  if (el.type === 'checkbox') return el.checked;
  const raw = el.value;
  if (el.dataset.kind === 'money') return raw === '' ? null : { amount: Number(raw), currency: el.dataset.currency || f.currency || '' };
  if (el.dataset.kind === 'quantity') return raw === '' ? null : Number(raw);
  if (el.dataset.kind === 'tags') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (el.type === 'number') return raw === '' ? null : Number(raw);
  return raw === '' ? null : raw;
}

function onInput(e) {
  const t = e.target;
  if (t.classList.contains('rec-title')) { change({ title: editableText(t).replace(/\n/g, ' ') }); return; }
  if (t.id === 'recNotes') { change({ notes: t.value }); return; }
  if (t.dataset.f && (t.type === 'text' || t.type === 'number' || t.type === 'url')) change({ values: { [t.dataset.f]: readInput(t) } });
}

function onChange(e) {
  const t = e.target;
  if (t.dataset.f && (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'date')) {
    change({ values: { [t.dataset.f]: readInput(t) } });
    flush();
  }
}

function onClick(e) {
  if (e.target.closest('[data-close]')) { close(); return; }
  const star = e.target.closest('[data-star]');
  if (star) {
    const key = star.parentElement.dataset.f;
    const r = data.get(recordId);
    const cur = Number(r.values && r.values[key]) || 0;
    const n = Number(star.dataset.star);
    change({ values: { [key]: cur === n ? null : n } });
    flush();
    return;
  }
  const un = e.target.closest('[data-unlink]');
  if (un) {
    const r = data.get(recordId);
    const cur = r.values && r.values[un.dataset.field];
    const ids = (Array.isArray(cur) ? cur : cur ? [cur] : []).filter((x) => x !== un.dataset.unlink);
    change({ values: { [un.dataset.field]: ids } });
    flush();
    return;
  }
  const add = e.target.closest('[data-addlink]');
  if (add) { linkMenu(add, add.dataset.addlink); return; }
  if (e.target.closest('[data-rec-menu]')) { recMenu(e.target.closest('[data-rec-menu]')); }
}

function linkMenu(anchor, key) {
  const f = fieldOf(key);
  const r = data.get(recordId);
  const cur = r.values && r.values[key];
  const have = new Set(Array.isArray(cur) ? cur : cur ? [cur] : []);
  const pool = (f && f.to ? recordsOf(f.to) : data.all('record')).filter((x) => x.id !== r.id && !have.has(x.id))
    .sort((a, b) => String(a.title).localeCompare(String(b.title))).slice(0, 60);
  openMenu(anchor, pool.length ? pool.map((x) => ({ label: titleOf(x), action: () => {
    change({ values: { [key]: [...have, x.id] } });
    flush();
  } })) : [{ heading: 'Nothing to link to yet' }]);
}

function recMenu(anchor) {
  const r = data.get(recordId);
  if (!r) return;
  openMenu(anchor, [
    { label: 'Delete item', icon: '🗑', danger: true, action: () => {
      const before = JSON.parse(JSON.stringify(r));
      data.remove(r.id);
      close();
      toast('Item deleted.', { label: 'Undo', run: () => data.put(before) });
    } },
  ]);
}

function close() {
  flush();
  document.dispatchEvent(new CustomEvent('dashboard:closepanel'));
}
