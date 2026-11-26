// Views: general ways of showing records. Each archetype draws the same
// data differently; none knows what the records are about.
//
//   table      rows and columns; on narrow screens every row becomes a card
//   board      columns by a status or select field; drag cards between columns
//              on a computer, swipe between columns on a phone
//   list       compact rows with the main values as chips
//   gallery    cards in a grid, with a picture if the type has an image field
//   checklist  tick boxes, for types with a checkbox field
//
// A view item can also carry a `result` instead of a record source: rows that
// Claude researched for a one-off view (see model.js). Those show as a table
// or list with their sources.

import { get, patch, remove, put } from './data.js';
import { ARCHETYPES, viewRecords, typeOf, recordsOf, newRecord, formatPlain, optionsOf, shownValues, valueOf } from './model.js';
import { esc, safeHref, icon, isDesktop, openMenu, toast, timeAgo } from './ui.js';

const MAX_COLUMNS = 7;

// Draws a view into host. opts.compact: fewer rows (Today), no switcher.
export function renderView(host, viewId, opts = {}) {
  const view = get(viewId);
  if (!view) {
    host.className = 'view gone';
    host.innerHTML = '<p class="muted small">This view was removed.</p>';
    const b = host.closest('.block');
    if (b) b.classList.add('missing');
    return;
  }
  if (view.result) { renderResult(host, view, opts); return; }
  const type = get(view.source && view.source.type);
  let records = viewRecords(view);
  const total = records.length;
  if (opts.compact) records = records.slice(0, opts.limit || 6);
  const arch = view.archetype || 'table';

  const head = '<div class="view-head">' +
    '<button class="view-title" type="button" data-open-view="' + esc(view.id) + '">' + esc(view.title || (type ? type.plural || type.name : 'View')) + '</button>' +
    '<span class="view-count">' + total + '</span>' +
    '<div class="spacer"></div>' +
    (opts.compact ? '' : '<div class="seg" role="group" aria-label="Show as">' + ARCHETYPES.map((a) =>
      '<button type="button" class="seg-btn' + (a.key === arch ? ' on' : '') + '" data-arch="' + a.key + '" title="' + esc(a.label) + '" aria-pressed="' + (a.key === arch) + '">' +
      '<span class="seg-ico">' + esc(a.icon) + '</span><span class="seg-label">' + esc(a.label) + '</span></button>').join('') + '</div>') +
    '<button type="button" class="iconbtn sm" data-view-menu aria-label="View options">' + icon('more') + '</button>' +
    '</div>';

  let body;
  if (!type) body = '<p class="muted small">This view has no kind of item to show yet. Claude sets that up when it organizes your data.</p>';
  else if (!records.length) body = '<p class="muted small v-empty">Nothing here yet.</p>';
  else body = ({ table, board, list, gallery, checklist }[arch] || table)(view, type, records, opts);

  const more = opts.compact && total > records.length
    ? '<button type="button" class="link small" data-open-view="' + esc(view.id) + '">Show all ' + total + '</button>' : '';
  const add = type && !opts.compact && arch !== 'board' && !(arch === 'checklist' && records.length)
    ? '<button type="button" class="add-row" data-add>' + icon('plus') + '<span>New</span></button>' : '';

  host.className = 'view arch-' + arch + (opts.compact ? ' compact' : '');
  host.dataset.view = view.id;
  host.innerHTML = head + '<div class="view-body">' + body + '</div>' + add + more;
  wire(host, view, type);
  if (refocus === view.id) {
    refocus = null;
    const q = host.querySelector('[data-quick-add]');
    if (q) q.focus();
  }
}

function columns(view, type) {
  const fields = type.fields || [];
  const keys = view.show && view.show.length ? view.show : fields.map((f) => f.key);
  return keys.map((k) => fields.find((f) => f.key === k)).filter(Boolean).slice(0, MAX_COLUMNS);
}

// ---------------------------------------------------------------- table

function table(view, type, records) {
  const cols = columns(view, type);
  const sort = (view.source.sort || [])[0] || {};
  const th = (key, label) => '<th><button type="button" class="th" data-sort="' + esc(key) + '">' + esc(label) +
    (sort.field === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '') + '</button></th>';
  return '<div class="table-wrap"><table class="tbl"><thead><tr>' + th('title', type.titleLabel || 'Name') +
    cols.map((f) => th(f.key, f.label)).join('') + '</tr></thead><tbody>' +
    records.map((r) => '<tr data-open="' + esc(r.id) + '" tabindex="0">' +
      '<td class="t-title" data-label="' + esc(type.titleLabel || 'Name') + '">' + esc(r.title || 'Untitled') + '</td>' +
      cols.map((f) => '<td data-label="' + esc(f.label) + '" class="' + (empty(valueOf(r, f.key)) ? 'is-empty' : '') + '">' + valueHTML(f, valueOf(r, f.key)) + '</td>').join('') +
      '</tr>').join('') + '</tbody></table></div>';
}

// ---------------------------------------------------------------- board

export function groupField(view, type) {
  const fields = type.fields || [];
  return fields.find((f) => f.key === view.source.group) ||
    fields.find((f) => f.type === 'status') || fields.find((f) => f.type === 'select') || null;
}

function board(view, type, records) {
  const g = groupField(view, type);
  if (!g) return '<p class="muted small">A board needs a status or choice field to make columns. ' + list(view, type, records) + '</p>';
  const opts = optionsOf(g);
  const cols = [...opts, { key: '', label: 'No ' + g.label.toLowerCase() }];
  const others = columns(view, type).filter((f) => f.key !== g.key).slice(0, 2);
  return '<div class="board" data-group="' + esc(g.key) + '">' + cols.map((o) => {
    const inCol = records.filter((r) => (o.key === '' ? !opts.some((x) => x.key === valueOf(r, g.key)) : valueOf(r, g.key) === o.key));
    if (o.key === '' && !inCol.length) return '';
    return '<section class="col" data-col="' + esc(o.key) + '">' +
      '<header class="col-head"><span class="pill ' + esc(colorClass(o)) + '">' + esc(o.label) + '</span><span class="view-count">' + inCol.length + '</span></header>' +
      '<div class="col-cards">' + inCol.map((r) => card(r, others, true)).join('') + '</div>' +
      '<button type="button" class="add-row" data-add data-add-value="' + esc(o.key) + '">' + icon('plus') + '<span>New</span></button>' +
      '</section>';
  }).join('') + '</div>';
}

function card(r, fields, draggable) {
  const vals = fields.map((f) => ({ f, v: valueOf(r, f.key) })).filter((x) => !empty(x.v));
  return '<article class="rcard" data-open="' + esc(r.id) + '" tabindex="0"' + (draggable ? ' draggable="true" data-drag="' + esc(r.id) + '"' : '') + '>' +
    '<div class="rcard-title">' + esc(r.title || 'Untitled') + '</div>' +
    (vals.length ? '<div class="chips">' + vals.map((x) => '<span class="chip">' + valueHTML(x.f, x.v) + '</span>').join('') + '</div>' : '') +
    '</article>';
}

// ---------------------------------------------------------------- list

function list(view, type, records) {
  const cols = columns(view, type).slice(0, 4);
  return '<ul class="rlist">' + records.map((r) => {
    const vals = cols.map((f) => ({ f, v: valueOf(r, f.key) })).filter((x) => !empty(x.v));
    return '<li class="rrow" data-open="' + esc(r.id) + '" tabindex="0"><span class="rrow-title">' + esc(r.title || 'Untitled') + '</span>' +
      '<span class="chips">' + vals.map((x) => '<span class="chip">' + valueHTML(x.f, x.v) + '</span>').join('') + '</span></li>';
  }).join('') + '</ul>';
}

// ---------------------------------------------------------------- gallery

function gallery(view, type, records) {
  const img = (type.fields || []).find((f) => f.type === 'image');
  const cols = columns(view, type).filter((f) => f.type !== 'image').slice(0, 3);
  return '<div class="gallery">' + records.map((r) => {
    const src = img ? safeHref(valueOf(r, img.key)) : '';
    return '<article class="gcard" data-open="' + esc(r.id) + '" tabindex="0">' +
      (img ? '<div class="gimg">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span>' + esc((r.title || '?').slice(0, 1)) + '</span>') + '</div>' : '') +
      '<div class="gbody"><div class="rcard-title">' + esc(r.title || 'Untitled') + '</div>' +
      cols.map((f) => empty(valueOf(r, f.key)) ? '' : '<div class="gval"><span class="muted">' + esc(f.label) + '</span> ' + valueHTML(f, valueOf(r, f.key)) + '</div>').join('') +
      '</div></article>';
  }).join('') + '</div>';
}

// ---------------------------------------------------------------- checklist
// Works like a phone's reminders app: round tick circles, a "New item" line
// at the bottom to type the next one straight in, ticked items folded away.

function checklist(view, type, records, opts = {}) {
  const box = (type.fields || []).find((f) => f.type === 'checkbox');
  if (!box) return '<p class="muted small">A checklist needs a tick-box field. Showing a list instead.</p>' + list(view, type, records);
  const others = columns(view, type).filter((f) => f.key !== box.key).slice(0, 2);
  const open = records.filter((r) => !valueOf(r, box.key));
  const done = records.filter((r) => valueOf(r, box.key));
  const row = (r) => '<li class="crow' + (valueOf(r, box.key) ? ' done' : '') + '">' +
    '<input type="checkbox" class="circle" data-check="' + esc(r.id) + '" data-field="' + esc(box.key) + '"' + (valueOf(r, box.key) ? ' checked' : '') + ' aria-label="' + esc(r.title || 'Untitled') + '">' +
    '<button type="button" class="crow-title" data-open="' + esc(r.id) + '">' + esc(r.title || 'Untitled') +
    (r.notes ? '<span class="crow-notes">' + esc(String(r.notes).split('\n')[0]) + '</span>' : '') + '</button>' +
    others.map((f) => empty(valueOf(r, f.key)) ? '' : '<span class="chip">' + valueHTML(f, valueOf(r, f.key)) + '</span>').join('') + '</li>';
  const quick = opts.compact ? '' : '<li class="crow quick"><span class="circle ghost" aria-hidden="true"></span>' +
    '<input type="text" class="quick-add" data-quick-add enterkeyhint="done" placeholder="New ' + esc((type.name || 'item').toLowerCase()) + '" aria-label="Add a new ' + esc((type.name || 'item').toLowerCase()) + '"></li>';
  return '<ul class="clist">' + open.map(row).join('') + quick + '</ul>' +
    (done.length ? '<details class="done-list"' + (openDone.has(view.id) ? ' open' : '') + '><summary>' + done.length + ' done</summary><ul class="clist">' + done.map(row).join('') + '</ul></details>' : '');
}

// Views whose "done" part is unfolded, and the view whose quick-add line
// should keep the cursor after the screen is drawn again.
const openDone = new Set();
let refocus = null;

// Values a new record gets so it shows in the view it was added from:
// the view's "is" filters.
function valuesFromFilters(view) {
  const values = {};
  for (const f of (view.source && view.source.filter) || []) {
    if (f.op === 'is' && f.field && f.field !== 'title') values[f.field] = f.value;
  }
  return values;
}

// ---------------------------------------------------------------- one-off results

function renderResult(host, view, opts) {
  const res = view.result || {};
  const cols = res.columns || [];
  let rows = res.rows || [];
  const total = rows.length;
  if (opts.compact) rows = rows.slice(0, opts.limit || 6);
  const asList = view.archetype === 'list';
  const cell = (c, row) => {
    const v = row[c.key];
    if (c.type === 'url') { const h = safeHref(v); return h ? '<a href="' + esc(h) + '" target="_blank" rel="noopener">' + esc(row[c.key + 'Label'] || new URL(h).hostname) + ' ↗</a>' : ''; }
    if (c.type === 'ref') { const it = get(v); return it ? '<button type="button" class="link" data-open="' + esc(it.id) + '">' + esc(it.title || 'Untitled') + '</button>' : esc(v); }
    return esc(formatPlain(c, v));
  };
  const head = '<div class="view-head"><button class="view-title" type="button" data-open-view="' + esc(view.id) + '">' + esc(view.title || 'View') + '</button>' +
    '<span class="view-count">' + total + '</span><div class="spacer"></div>' +
    (view.keep ? '' : '<span class="pill p-amber" title="Made for one moment; keep it to save it">One-off</span>') +
    '<button type="button" class="iconbtn sm" data-view-menu aria-label="View options">' + icon('more') + '</button></div>';
  const body = !rows.length ? '<p class="muted small v-empty">Nothing found.</p>' : asList
    ? '<ul class="rlist">' + rows.map((row) => '<li class="rrow"><span class="rrow-title">' + cell(cols[0] || { key: 'title' }, row) + '</span><span class="chips">' +
        cols.slice(1).map((c) => empty(row[c.key]) ? '' : '<span class="chip">' + cell(c, row) + '</span>').join('') + '</span></li>').join('') + '</ul>'
    : '<div class="table-wrap"><table class="tbl"><thead><tr>' + cols.map((c) => '<th><span class="th">' + esc(c.label) + '</span></th>').join('') + '</tr></thead><tbody>' +
      rows.map((row) => '<tr>' + cols.map((c, i) => '<td data-label="' + esc(c.label) + '"' + (i === 0 ? ' class="t-title"' : '') + '>' + cell(c, row) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  const foot = (res.note ? '<p class="muted small">' + esc(res.note) + '</p>' : '') +
    (res.sources && res.sources.length && !opts.compact ? '<details class="sources"><summary>Sources</summary><ul>' + res.sources.map((s) => {
      const h = safeHref(s.url);
      return '<li>' + (h ? '<a href="' + esc(h) + '" target="_blank" rel="noopener">' + esc(s.title || h) + '</a>' : esc(s.title)) + '</li>';
    }).join('') + '</ul></details>' : '') +
    (res.at ? '<p class="muted small">Found ' + esc(timeAgo(res.at)) + (view.by === 'claude' || view.createdBy === 'claude' ? ' by Claude' : '') + '.</p>' : '');
  host.className = 'view arch-' + (asList ? 'list' : 'table') + ' result' + (opts.compact ? ' compact' : '');
  host.dataset.view = view.id;
  host.innerHTML = head + '<div class="view-body">' + body + '</div>' + foot;
  wire(host, view, null);
}

// ---------------------------------------------------------------- values

// Nothing worth showing (an unticked box counts as nothing, too).
export function empty(v) {
  return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && !v.length);
}

function colorClass(o) {
  const c = String(o.color || '').toLowerCase();
  return ['green', 'amber', 'red', 'blue', 'grey', 'purple'].includes(c) ? 'p-' + c : 'p-grey';
}

// A value as HTML, for tables, cards and the record panel.
export function valueHTML(field, v) {
  if (empty(v)) return '';
  switch (field.type) {
    case 'status': case 'select': {
      const o = optionsOf(field).find((x) => x.key === v) || { key: v, label: v };
      return '<span class="pill ' + esc(colorClass(o)) + '">' + esc(o.label) + '</span>';
    }
    case 'tags': return (Array.isArray(v) ? v : [v]).map((t) => '<span class="tag">' + esc(t) + '</span>').join(' ');
    case 'checkbox': return v ? '<span class="tick">✓</span>' : '';
    case 'url': {
      const h = safeHref(v);
      return h ? '<a href="' + esc(h) + '" target="_blank" rel="noopener" data-stop>' + esc(new URL(h).hostname.replace(/^www\./, '')) + ' ↗</a>' : esc(v);
    }
    case 'image': {
      const h = safeHref(v);
      return h ? '<img class="thumb" src="' + esc(h) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '';
    }
    case 'link': {
      const ids = Array.isArray(v) ? v : [v];
      return ids.map((id) => get(id)).filter(Boolean).map((it) => '<span class="ref">' + esc(it.title || 'Untitled') + '</span>').join(' ');
    }
    default: return esc(formatPlain(field, v));
  }
}

// ---------------------------------------------------------------- behaviour

function wire(host, view, type) {
  host.onclick = (e) => {
    if (e.target.closest('[data-stop]')) return;
    const arch = e.target.closest('[data-arch]');
    if (arch) { patch(view.id, { archetype: arch.dataset.arch }); return; }
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const cur = (view.source.sort || [])[0] || {};
      const dir = cur.field === sortBtn.dataset.sort && cur.dir === 'asc' ? 'desc' : 'asc';
      patch(view.id, { source: { ...view.source, sort: [{ field: sortBtn.dataset.sort, dir }] } });
      return;
    }
    const openV = e.target.closest('[data-open-view]');
    if (openV) { location.hash = '#v/' + openV.dataset.openView; return; }
    const menu = e.target.closest('[data-view-menu]');
    if (menu) { viewMenu(menu, view, type); return; }
    const add = e.target.closest('[data-add]');
    if (add && type) {
      const values = valuesFromFilters(view);
      const g = groupField(view, type);
      if (add.dataset.addValue !== undefined && g && add.dataset.addValue) values[g.key] = add.dataset.addValue;
      const r = newRecord(type.id, '', values);
      location.hash = '#r/' + r.id;
      return;
    }
    if (e.target.closest('[data-check]')) return;
    const open = e.target.closest('[data-open]');
    if (open) location.hash = '#r/' + open.dataset.open;
  };
  host.onkeydown = (e) => {
    const q = e.target.closest && e.target.closest('[data-quick-add]');
    if (q) {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const title = q.value.trim();
      if (!title || !type) return;
      q.value = '';
      refocus = view.id;
      const box = (type.fields || []).find((f) => f.type === 'checkbox');
      newRecord(type.id, title, { ...valuesFromFilters(view), ...(box ? { [box.key]: false } : {}) });
      // if nothing redraws the view, the cursor simply stays here
      setTimeout(() => { if (refocus === view.id) refocus = null; }, 1000);
      return;
    }
    const open = e.target.closest && e.target.closest('[data-open]');
    if (open && e.key === 'Enter' && open.tagName !== 'BUTTON') location.hash = '#r/' + open.dataset.open;
  };
  host.onchange = (e) => {
    const box = e.target.closest('[data-check]');
    if (box) {
      const r = get(box.dataset.check);
      const row = box.closest('.crow');
      if (row) row.classList.toggle('done', box.checked);
      // a short pause so the circle is seen filling before the item moves
      if (r) setTimeout(() => patch(r.id, { values: { ...((get(r.id) || r).values || {}), [box.dataset.field]: box.checked } }), box.checked ? 450 : 0);
    }
  };
  if (!host.dataset.toggleWired) {
    host.dataset.toggleWired = '1';
    host.addEventListener('toggle', (e) => {
      if (!e.target.matches || !e.target.matches('details.done-list')) return;
      if (e.target.open) openDone.add(host.dataset.view); else openDone.delete(host.dataset.view);
    }, true);
  }
  // drag a card to another column (computer)
  host.ondragstart = (e) => {
    const c = e.target.closest('[data-drag]');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.drag);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
  };
  host.ondragend = (e) => { const c = e.target.closest && e.target.closest('[data-drag]'); if (c) c.classList.remove('dragging'); };
  host.ondragover = (e) => {
    const col = e.target.closest('[data-col]');
    if (!col) return;
    e.preventDefault();
    for (const c of host.querySelectorAll('.col.over')) if (c !== col) c.classList.remove('over');
    col.classList.add('over');
  };
  host.ondragleave = (e) => { const col = e.target.closest('[data-col]'); if (col && !col.contains(e.relatedTarget)) col.classList.remove('over'); };
  host.ondrop = (e) => {
    const col = e.target.closest('[data-col]');
    if (!col || !type) return;
    e.preventDefault();
    col.classList.remove('over');
    const r = get(e.dataTransfer.getData('text/plain'));
    const g = groupField(view, type);
    if (r && g) patch(r.id, { values: { ...(r.values || {}), [g.key]: col.dataset.col || null } });
  };
}

function viewMenu(anchor, view, type) {
  const items = [];
  items.push({ label: view.pinned ? 'Unpin from Today' : 'Pin to Today', icon: '📌', action: () => patch(view.id, { pinned: !view.pinned }) });
  if (!view.keep) items.push({ label: 'Keep this view', hint: 'It is one-off now', icon: '✓', action: () => { patch(view.id, { keep: true }); toast('Kept.'); } });
  items.push({ label: 'Open on its own', icon: '↗', action: () => { location.hash = '#v/' + view.id; } });
  if (type) {
    const g = groupField(view, type);
    const choices = (type.fields || []).filter((f) => f.type === 'status' || f.type === 'select');
    if (choices.length > 1 && (view.archetype === 'board')) {
      items.push({ heading: 'Columns by' });
      for (const f of choices) items.push({ label: f.label, icon: g && g.key === f.key ? '•' : '', action: () => patch(view.id, { source: { ...view.source, group: f.key } }) });
    }
  }
  items.push({ heading: '' });
  items.push({ label: 'Rename', icon: '✎', action: () => {
    const t = prompt('Name of this view', view.title || '');
    if (t !== null) patch(view.id, { title: t.trim() });
  } });
  items.push({ label: 'Delete view', hint: 'The items stay', icon: '🗑', danger: true, action: () => {
    const before = get(view.id);
    remove(view.id);
    toast('View deleted.', { label: 'Undo', run: () => put({ ...before }) });
  } });
  openMenu(anchor, items);
}

// For a type without a view yet: an ad-hoc view object (not saved).
export function defaultViewFor(type) {
  return { kind: 'view', title: type.plural || type.name, archetype: 'table', source: { type: type.id, filter: [], sort: [] }, show: [], keep: true };
}

export function countOf(typeId) { return recordsOf(typeId).length; }
export { shownValues };
