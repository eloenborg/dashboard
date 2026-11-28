// The general building blocks of Ebbe's workspace. Nothing here is about
// what he keeps: that is data on his Drive. This file only says what kinds of
// things exist and how to make and find them.
//
// Item kinds (each is an item in js/data.js):
//   page    { title, icon, parent, order, blocks: [block] }
//   event, calendar, period   the calendar's items: see js/calendar.js
//   type    a kind of record, usually worked out by Claude:
//           { name, plural, icon, fields: [field] }
//   record  one thing of a type: { type, title, values: { fieldKey: value }, links: [{ to, rel }], notes }
//   view    a saved way of showing records:
//           { title, archetype, source: { type, filter, sort, group }, show: [fieldKey], keep, page, result }
//           keep: false marks a one-off view; result can hold a snapshot (rows) for one-off views
//           that were researched rather than computed, e.g. { columns: [...], rows: [...] }.
//   brief   a daily brief: { date, title, sections: [{ title, items: [{ text, url, source, at }] }] }
//
// Blocks live inside a page: { id, type, text, checked, view, ref }.

import { all, get, put } from './data.js';
import { uid } from './store.js';

export const BLOCKS = [
  { type: 'text', label: 'Text', hint: 'Plain writing', md: '' },
  { type: 'h1', label: 'Heading 1', hint: 'Big section heading', md: '# ' },
  { type: 'h2', label: 'Heading 2', hint: 'Medium heading', md: '## ' },
  { type: 'h3', label: 'Heading 3', hint: 'Small heading', md: '### ' },
  { type: 'bullet', label: 'Bulleted list', hint: 'A simple list', md: '- ' },
  { type: 'number', label: 'Numbered list', hint: 'A list with numbers', md: '1. ' },
  { type: 'todo', label: 'To-do', hint: 'Something to tick off', md: '[] ' },
  { type: 'quote', label: 'Quote', hint: 'A quotation', md: '> ' },
  { type: 'callout', label: 'Callout', hint: 'Make something stand out', md: '! ' },
  { type: 'code', label: 'Code', hint: 'Fixed-width text', md: '```' },
  { type: 'divider', label: 'Divider', hint: 'A line between sections', md: '---' },
];
export const TEXT_BLOCKS = new Set(['text', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote', 'callout', 'code']);
export const LIST_BLOCKS = new Set(['bullet', 'number', 'todo']);

export const FIELD_TYPES = ['text', 'number', 'quantity', 'money', 'date', 'status', 'select', 'tags',
  'checkbox', 'rating', 'url', 'link', 'image'];

export const ARCHETYPES = [
  { key: 'table', label: 'Table', icon: '▦' },
  { key: 'board', label: 'Board', icon: '▥' },
  { key: 'list', label: 'List', icon: '☰' },
  { key: 'gallery', label: 'Gallery', icon: '▣' },
  { key: 'checklist', label: 'Checklist', icon: '☑' },
];

// ---------------------------------------------------------------- making

export function newBlock(type = 'text', text = '') {
  return { id: uid(), type, text };
}

export function newPage({ title = '', parent = null, blocks } = {}) {
  const siblings = childPages(parent);
  const order = siblings.length ? Math.max(...siblings.map((p) => p.order || 0)) + 1 : 1;
  return put({ id: uid(), kind: 'page', title, icon: '', parent, order, blocks: blocks || [newBlock()] });
}

export function newRecord(typeId, title = '', values = {}) {
  return put({ id: uid(), kind: 'record', type: typeId, title, values, links: [] });
}

export function newView({ title, archetype = 'table', type, page = null, group = '', keep = true }) {
  return put({ id: uid(), kind: 'view', title, archetype, source: { type, filter: [], sort: [], group }, show: [], keep, page });
}

// ---------------------------------------------------------------- finding

export function pages() { return all('page'); }

export function childPages(parent = null) {
  return all('page').filter((p) => (p.parent || null) === (parent || null) && (!p.parent || get(p.parent)))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.title).localeCompare(String(b.title)));
}

// Pages whose parent is gone count as top-level, so nothing is ever lost.
export function topPages() {
  return all('page').filter((p) => !p.parent || !get(p.parent))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.title).localeCompare(String(b.title)));
}

export function ancestors(page) {
  const out = [];
  let cur = page && page.parent ? get(page.parent) : null;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) { out.unshift(cur); seen.add(cur.id); cur = cur.parent ? get(cur.parent) : null; }
  return out;
}

export function descendants(pageId) {
  const out = [];
  const walk = (id) => { for (const c of all('page').filter((p) => p.parent === id)) { out.push(c); walk(c.id); } };
  walk(pageId);
  return out;
}

export function types() {
  return all('type').sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function recordsOf(typeId) {
  return all('record').filter((r) => r.type === typeId);
}

export function typeOf(record) {
  return record ? get(record.type) : null;
}

export function titleOf(it) {
  if (!it) return '';
  if (it.kind === 'type') return it.plural || it.name || 'Untitled';
  return it.title || (it.kind === 'brief' ? 'Brief' : 'Untitled');
}

// Items that point at this one: records linking to it, pages with a block
// referring to it, views showing its type.
export function backlinks(id) {
  const out = [];
  for (const r of all('record')) {
    if (r.id !== id && (r.links || []).some((l) => l.to === id)) out.push({ item: r, why: rel(r, id) });
    else if (r.id !== id) {
      const t = typeOf(r);
      for (const f of (t && t.fields) || []) {
        const v = r.values && r.values[f.key];
        if (f.type === 'link' && (v === id || (Array.isArray(v) && v.includes(id)))) { out.push({ item: r, why: f.label }); break; }
      }
    }
  }
  for (const p of all('page')) {
    if ((p.blocks || []).some((b) => b.ref === id)) out.push({ item: p, why: 'mentioned' });
  }
  return out;
}

function rel(r, id) {
  const l = (r.links || []).find((x) => x.to === id);
  return (l && l.rel) || 'linked';
}

// The values of a record, ready to show: [{ field, value }] for fields that have one.
export function shownValues(record, keys) {
  const t = typeOf(record);
  const fields = (t && t.fields) || [];
  const pick = keys && keys.length ? keys.map((k) => fields.find((f) => f.key === k)).filter(Boolean) : fields;
  return pick.map((f) => ({ field: f, value: record.values ? record.values[f.key] : undefined }))
    .filter((x) => x.value !== undefined && x.value !== null && x.value !== '' && !(Array.isArray(x.value) && !x.value.length));
}

// Records a view shows, filtered and sorted. One-off researched views have
// a result instead; see views.js.
export function viewRecords(view) {
  const src = (view && view.source) || {};
  let list = src.type ? recordsOf(src.type) : all('record');
  for (const f of src.filter || []) list = list.filter((r) => matches(r, f));
  const sorts = (src.sort && src.sort.length) ? src.sort : [{ field: 'title', dir: 'asc' }];
  list.sort((a, b) => {
    for (const s of sorts) {
      const c = compare(valueOf(a, s.field), valueOf(b, s.field));
      if (c) return s.dir === 'desc' ? -c : c;
    }
    return 0;
  });
  return list;
}

export function valueOf(record, key) {
  if (key === 'title') return record.title;
  if (key === 'updatedAt' || key === 'createdAt') return record[key];
  return record.values ? record.values[key] : undefined;
}

function compare(a, b) {
  const empty = (v) => v === undefined || v === null || v === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'object' && a && 'amount' in a && b && 'amount' in b) return (a.amount || 0) - (b.amount || 0);
  return String(Array.isArray(a) ? a.join(',') : a).localeCompare(String(Array.isArray(b) ? b.join(',') : b), undefined, { numeric: true });
}

// filter: { field, op: 'is'|'not'|'has'|'empty'|'notEmpty'|'lt'|'gt'|'contains', value }
export function matches(record, f) {
  const v = valueOf(record, f.field);
  const num = (x) => (x && typeof x === 'object' && 'amount' in x ? x.amount : Number(x));
  switch (f.op) {
    case 'is': return Array.isArray(v) ? v.includes(f.value) : v === f.value;
    case 'not': return Array.isArray(v) ? !v.includes(f.value) : v !== f.value;
    case 'in': return (f.value || []).includes(v);
    case 'has': return Array.isArray(v) && v.includes(f.value);
    case 'empty': return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    case 'notEmpty': return !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length));
    case 'lt': return num(v) < Number(f.value);
    case 'gt': return num(v) > Number(f.value);
    case 'contains': return String(v ?? '').toLowerCase().includes(String(f.value ?? '').toLowerCase());
    default: return true;
  }
}

// ---------------------------------------------------------------- searching

export function search(q, limit = 40) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const hits = [];
  const score = (title, body) => {
    const t = String(title || '').toLowerCase();
    const b = String(body || '').toLowerCase();
    if (!words.every((w) => t.includes(w) || b.includes(w))) return 0;
    return 1 + (t.startsWith(q) ? 6 : 0) + (t.includes(q) ? 3 : 0) + words.filter((w) => t.includes(w)).length;
  };
  for (const p of all('page')) {
    const body = (p.blocks || []).map((b) => b.text || '').join('\n');
    const s = score(p.title, body);
    if (s) hits.push({ item: p, score: s + 0.5, snippet: snippet(body, words[0]) });
  }
  for (const r of all('record')) {
    const t = typeOf(r);
    const body = [r.notes || '', ...shownValues(r).map((x) => formatPlain(x.field, x.value)), t ? t.name : ''].filter(Boolean).join(' · ');
    const s = score(r.title, body);
    if (s) hits.push({ item: r, score: s, snippet: (t ? t.name + ' · ' : '') + snippet(body, words[0]) });
  }
  for (const v of all('view')) {
    const s = score(v.title, '');
    if (s) hits.push({ item: v, score: s, snippet: 'View' });
  }
  return hits.sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0)).slice(0, limit);
}

function snippet(text, word) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const i = t.toLowerCase().indexOf(word || '');
  if (i < 0) return t.slice(0, 90);
  const start = Math.max(0, i - 30);
  return (start ? '…' : '') + t.slice(start, start + 110) + (start + 110 < t.length ? '…' : '');
}

// A value as plain text (for search and small labels).
export function formatPlain(field, v) {
  if (v === undefined || v === null || v === '') return '';
  switch (field && field.type) {
    case 'money': {
      const amount = Number(typeof v === 'object' ? v.amount : v);
      const cur = String((typeof v === 'object' && v.currency) || field.currency || '').toUpperCase();
      if (/^[A-Z]{3}$/.test(cur)) {
        try { return amount.toLocaleString(undefined, { style: 'currency', currency: cur, minimumFractionDigits: Number.isInteger(amount) ? 0 : 2 }); } catch (e) { /* unknown code */ }
      }
      return amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
    }
    case 'quantity': return String(typeof v === 'object' ? v.amount : v) + (field.unit ? ' ' + field.unit : '');
    case 'checkbox': return v ? '✓' : '';
    case 'rating': return '★'.repeat(Number(v) || 0);
    case 'date': {
      const d = new Date(String(v).length === 10 ? v + 'T12:00:00' : v);
      return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }
    case 'link': {
      const ids = Array.isArray(v) ? v : [v];
      return ids.map((id) => titleOf(get(id))).filter(Boolean).join(', ');
    }
    case 'tags': return (Array.isArray(v) ? v : [v]).join(', ');
    case 'status': case 'select': {
      const o = (field.options || []).find((x) => (x.key ?? x) === v);
      return o ? (o.label ?? o) : String(v);
    }
    default: return Array.isArray(v) ? v.join(', ') : String(v);
  }
}

// The options of a status or select field as [{ key, label, color }].
export function optionsOf(field) {
  return (field.options || []).map((o) => (typeof o === 'string' ? { key: o, label: o } : { key: o.key ?? o.label, label: o.label ?? o.key, color: o.color }));
}
