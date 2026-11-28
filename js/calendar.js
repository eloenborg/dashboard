// Calendar: one screen you zoom in and out of.
//
//   day      hour by hour
//   week     seven days
//   month    a month grid
//   quarter  three months, with the marked days and periods
//   year     twelve small months
//   road     the years as a winding road, scrolling down into later years
//
// Zoom with a pinch (phone, trackpad), Ctrl + mouse wheel, the − and +
// buttons, the + and − keys, or by tapping into a day or month. Each step
// morphs out of the one before, centred where you zoomed.
//
// What it shows (all data items, see js/model.js for the contract):
//   event     { title, start, end, allDay, location, note, url, cal, color,
//               source: 'calendar' | 'mail' | ..., attention, mark }
//             start/end: 'YYYY-MM-DD' for all-day items (end is the day after,
//             as in Google Calendar), else ISO times. Claude's runs fill these
//             from his calendars and mail.
//   calendar  { name, color, hidden }  where events come from (event.cal)
//   period    { title, start, end, group, color, note }  a stretch of days
//             (end is the last day), e.g. holidays from school; shown on the
//             road, the year and the quarter.
// Public holidays and seasons are worked out in js/holidays.js.

import * as data from './data.js';
import { holidays, seasons, seasonOf } from './holidays.js';
import { COUNTRY } from './config.js';
import { $, esc, safeHref } from './ui.js';

const LEVELS = ['day', 'week', 'month', 'quarter', 'year', 'road'];
const LABEL = { day: 'Day', week: 'Week', month: 'Month', quarter: '3 months', year: 'Year', road: 'Years' };
const UI_KEY = 'dashboard.calendar';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink', 'orange', 'grey'];

let ui = { level: 'month', focus: '', sel: '' };   // loaded in initCalendar()
let index = null;            // built from the data on demand
let roadYears = 5;
let busy = false;            // a morph is running

// ---------------------------------------------------------------- dates

const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export function dayOf(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const wdIndex = (d) => (d.getDay() + 6) % 7;        // Monday = 0
const startOfWeek = (d) => addDays(d, -wdIndex(d));
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const w1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7);
}
const hm = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const dayName = (d) => WD_LONG[wdIndex(d)] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
const shortDay = (d) => WD[wdIndex(d)] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);

// ---------------------------------------------------------------- the data

// Turns event items into occurrences with real Date objects, and indexes
// them, the periods and the holidays by day ('YYYY-MM-DD').
export function buildIndex(items) {
  const cals = new Map(items.filter((i) => i.kind === 'calendar').map((c) => [c.id, c]));
  const byDay = new Map();
  const add = (k, o) => { let l = byDay.get(k); if (!l) byDay.set(k, (l = [])); l.push(o); };
  const marks = [];
  for (const it of items) {
    if (it.kind !== 'event' || !it.start) continue;
    const cal = it.cal ? cals.get(it.cal) : null;
    if (cal && cal.hidden) continue;
    const o = occurrence(it, cal);
    if (!o) continue;
    for (let d = o.firstDay; d <= o.lastDay; d = addDays(d, 1)) add(keyOf(d), o);
    if (it.mark || it.attention) marks.push(o);
  }
  for (const l of byDay.values()) l.sort(byStart);
  const periods = items.filter((i) => i.kind === 'period' && dayOf(i.start)).map((p) => {
    const s = dayOf(p.start), e = dayOf(p.end) || s;
    return { id: p.id, title: p.title || 'Untitled', start: s, end: e < s ? s : e, group: p.group || '', color: COLORS.includes(p.color) ? p.color : '', note: p.note || '' };
  }).sort((a, b) => a.start - b.start);
  // a colour per group of periods, so school and daycare differ
  const groups = [];
  for (const p of periods) if (!groups.includes(p.group)) groups.push(p.group);
  const AUTO = ['purple', 'teal', 'pink', 'orange', 'blue', 'green'];
  for (const p of periods) { p.lane = groups.indexOf(p.group); if (!p.color) p.color = AUTO[p.lane % AUTO.length]; }
  return { byDay, periods, groups, marks: marks.sort(byStart), cals };
}

// An event's colour, as the calendar shows it: its own, its calendar's,
// amber for ones found in mail, else blue. Also used by the brief on Today.
export function eventColor(it, cal) {
  return COLORS.includes(it.color) ? it.color : cal && COLORS.includes(cal.color) ? cal.color : it.source === 'mail' ? 'amber' : 'blue';
}
export const isColor = (c) => COLORS.includes(c);

function occurrence(it, cal) {
  const color = eventColor(it, cal);
  const base = { id: it.id, item: it, title: it.title || 'Untitled', color, attention: !!it.attention, mark: !!it.mark, calName: cal ? cal.name : '' };
  const timed = !it.allDay && /T\d/.test(String(it.start));
  if (!timed) {
    const s = dayOf(it.start);
    if (!s) return null;
    let e = dayOf(it.end);
    e = e && e > s ? addDays(e, -1) : s;                // the end date is the day after
    return { ...base, allDay: true, start: s, end: addDays(e, 1), firstDay: s, lastDay: e };
  }
  const s = new Date(it.start);
  if (isNaN(s)) return null;
  let e = it.end ? new Date(it.end) : new Date(s.getTime() + 3600e3);
  if (isNaN(e) || e <= s) e = new Date(s.getTime() + 30 * 60e3);
  const first = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  let last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  if (+last === +e && last > first) last = addDays(last, -1);   // ends at midnight
  return { ...base, allDay: false, start: s, end: e, firstDay: first, lastDay: last };
}

function byStart(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start - b.start || (a.title < b.title ? -1 : 1);
}

function idx() {
  if (!index) index = buildIndex(data.all());
  return index;
}
const eventsOn = (d) => idx().byDay.get(keyOf(d)) || [];
const periodsOn = (d) => idx().periods.filter((p) => p.start <= d && d <= p.end);
function holidaysOn(d) {
  const k = keyOf(d);
  return holidays(d.getFullYear(), COUNTRY).filter((h) => h.date === k);
}

// ---------------------------------------------------------------- state

function loadUi() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (e) { /* nothing saved */ }
  return { level: LEVELS.includes(s.level) ? s.level : 'month', focus: dayOf(s.focus) ? s.focus : keyOf(today()), sel: '' };
}
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ level: ui.level, focus: ui.focus })); } catch (e) { /* private mode */ }
}
const focus = () => dayOf(ui.focus) || today();

// ---------------------------------------------------------------- screen

export function initCalendar() {
  ui = loadUi();
  const stage = $('#calStage');
  $('#calLevels').innerHTML = LEVELS.map((l) => '<button type="button" class="seg-btn" data-level="' + l + '">' + esc(LABEL[l]) + '</button>').join('');
  $('#calLevels').addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (b) zoomTo(b.dataset.level);
  });
  $('#calIn').addEventListener('click', () => zoomBy(-1));
  $('#calOut').addEventListener('click', () => zoomBy(1));
  $('#calPrev').addEventListener('click', () => step(-1));
  $('#calNext').addEventListener('click', () => step(1));
  $('#calToday').addEventListener('click', () => {
    ui.focus = keyOf(today()); ui.sel = '';
    saveUi(); render();
    if (ui.level === 'road') scrollToToday();
  });
  stage.addEventListener('click', onClick);
  $('#calPop').addEventListener('click', (e) => { if (e.target === $('#calPop') || e.target.closest('[data-pop-close]')) closePop(); });
  initGestures(stage);
  document.addEventListener('keydown', (e) => {
    if ($('#screen-calendar').hidden || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (a.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a.tagName))) return;
    if (e.key === 'Escape' && !$('#calPop').hidden) { closePop(); return; }
    if (e.ctrlKey) return;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(-1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1); }
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 't') $('#calToday').click();
  });
  document.addEventListener('dashboard:data', () => {
    index = null;
    if (!$('#screen-calendar').hidden && !busy) clearTimeout(dataTimer), (dataTimer = setTimeout(() => render(), 120));
  });
  let lastW = 0;
  window.addEventListener('resize', () => {
    if ($('#screen-calendar').hidden) return;
    const w = stage.clientWidth;
    if (Math.abs(w - lastW) > 40) { lastW = w; render(); }
  });
}
let dataTimer = null;

export function renderCalendar() {
  closePop();
  render();
  if (ui.level === 'road') scrollToToday();
}

function render(layer) {
  const stage = $('#calStage');
  const host = layer || stage.querySelector('.cal-layer:not(.leaving)') || stage.appendChild(Object.assign(document.createElement('div'), { className: 'cal-layer' }));
  host.className = 'cal-layer lv-' + ui.level;
  host.innerHTML = VIEW[ui.level](focus(), stage.clientWidth || 360);
  chrome();
  if (ui.level === 'road') watchRoad(host);
  return host;
}

function chrome() {
  const f = focus();
  const t = {
    day: dayName(f) + (f.getFullYear() !== today().getFullYear() ? ' ' + f.getFullYear() : ''),
    week: 'Week ' + isoWeek(f) + ' · ' + weekRange(f),
    month: MONTHS[f.getMonth()] + ' ' + f.getFullYear(),
    quarter: quarterTitle(f),
    year: String(f.getFullYear()),
    road: 'The years ahead',
  }[ui.level];
  $('#calTitle').textContent = t;
  for (const b of $('#calLevels').children) b.classList.toggle('on', b.dataset.level === ui.level);
  $('#calIn').disabled = ui.level === 'day';
  $('#calOut').disabled = ui.level === 'road';
  $('#calPrev').hidden = $('#calNext').hidden = ui.level === 'road';
}

function weekRange(f) {
  const s = startOfWeek(f), e = addDays(s, 6);
  return s.getMonth() === e.getMonth() ? s.getDate() + '–' + e.getDate() + ' ' + MONTHS[s.getMonth()].slice(0, 3)
    : s.getDate() + ' ' + MONTHS[s.getMonth()].slice(0, 3) + ' – ' + e.getDate() + ' ' + MONTHS[e.getMonth()].slice(0, 3);
}
function quarterStart(f) { return new Date(f.getFullYear(), f.getMonth() - (f.getMonth() % 3), 1); }
function quarterTitle(f) {
  const s = quarterStart(f), e = addMonths(s, 2);
  return MONTHS[s.getMonth()].slice(0, 3) + ' – ' + MONTHS[e.getMonth()].slice(0, 3) + ' ' + e.getFullYear();
}

function step(dir) {
  const f = focus();
  const n = {
    day: () => addDays(f, dir),
    week: () => addDays(f, 7 * dir),
    month: () => new Date(f.getFullYear(), f.getMonth() + dir, 1),
    quarter: () => new Date(f.getFullYear(), f.getMonth() + 3 * dir, 1),
    year: () => new Date(f.getFullYear() + dir, f.getMonth(), 1),
    road: () => f,
  }[ui.level]();
  ui.focus = keyOf(n); ui.sel = '';
  saveUi();
  slide(dir);
}

// ---------------------------------------------------------------- zooming

function zoomBy(n, anchor) {
  const i = LEVELS.indexOf(ui.level) + n;
  if (i < 0 || i >= LEVELS.length) return bounce(n);
  zoomTo(LEVELS[i], anchor);
}

// anchor: { day: 'YYYY-MM-DD', x, y } (x, y relative to the stage), the
// point the new view grows out of or shrinks into.
function zoomTo(level, anchor) {
  if (level === ui.level || busy) return;
  const from = LEVELS.indexOf(ui.level), to = LEVELS.indexOf(level);
  if (anchor && anchor.day) ui.focus = anchor.day;
  const wasRoad = ui.level === 'road';
  ui.level = level; ui.sel = '';
  saveUi();
  morph(to < from ? 'in' : 'out', anchor);
  if (level === 'road' && !wasRoad) scrollToFocus();
  else if (wasRoad) window.scrollTo(0, 0);
}

function reduced() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }

// The old view grows (zooming in) or shrinks (zooming out) and fades while
// the new one comes from the other side, both about the anchor point.
function morph(dir, anchor) {
  const stage = $('#calStage');
  const old = stage.querySelector('.cal-layer:not(.leaving)');
  if (!old || reduced() || !old.animate) { render(old); return; }
  busy = true;
  const r = stage.getBoundingClientRect();
  const ox = anchor && anchor.x != null ? anchor.x : r.width / 2;
  const oy = anchor && anchor.y != null ? anchor.y : Math.min(r.height, innerHeight) / 3;
  const cur = parseFloat(old.style.getPropertyValue('--live') || '1') || 1;
  old.classList.add('leaving');
  old.style.transformOrigin = ox + 'px ' + oy + 'px';
  stage.style.minHeight = old.offsetHeight + 'px';
  const fresh = document.createElement('div');
  stage.appendChild(fresh);
  render(fresh);
  fresh.style.transformOrigin = ox + 'px ' + Math.min(oy, fresh.offsetHeight / 2 || oy) + 'px';
  const big = 1.6, small = 0.62, ms = 300;
  const ease = 'cubic-bezier(.2,.7,.2,1)';
  old.animate([{ transform: 'scale(' + cur + ')', opacity: 1 }, { transform: 'scale(' + (dir === 'in' ? big : small) + ')', opacity: 0 }], { duration: ms, easing: ease, fill: 'forwards' });
  const a = fresh.animate([{ transform: 'scale(' + (dir === 'in' ? small : big) + ')', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: ms, easing: ease });
  a.onfinish = a.oncancel = () => {
    old.remove();
    stage.style.minHeight = '';
    fresh.style.transformOrigin = '';
    busy = false;
  };
}

// Moving to the next or previous day, week, month: a short slide.
function slide(dir) {
  const stage = $('#calStage');
  const host = render();
  if (reduced() || !host.animate) return;
  host.animate([{ transform: 'translateX(' + (dir * 36) + 'px)', opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'ease-out' });
  void stage;
}

function bounce(n) {
  const host = $('#calStage .cal-layer');
  if (!host || !host.animate || reduced()) return;
  const s = n < 0 ? 1.03 : 0.97;
  host.animate([{ transform: 'scale(1)' }, { transform: 'scale(' + s + ')' }, { transform: 'scale(1)' }], { duration: 220 });
}

// The day (or month) under a point, so a pinch zooms into what is under it.
function anchorAt(clientX, clientY) {
  const stage = $('#calStage');
  const r = stage.getBoundingClientRect();
  const el = document.elementFromPoint(clientX, clientY);
  const at = el && el.closest && el.closest('[data-day]');
  return { day: at ? at.dataset.day : null, x: clientX - r.left, y: clientY - r.top };
}

function setLive(s, ox, oy) {
  const host = $('#calStage .cal-layer:not(.leaving)');
  if (!host) return;
  if (s === 1) { host.style.transform = ''; host.style.removeProperty('--live'); return; }
  if (ox != null) host.style.transformOrigin = ox + 'px ' + oy + 'px';
  host.style.transform = 'scale(' + s + ')';
  host.style.setProperty('--live', String(s));
}
function snapBack() {
  const host = $('#calStage .cal-layer:not(.leaving)');
  if (!host || !host.style.transform) return;
  const cur = host.style.transform;
  setLive(1);
  if (host.animate && !reduced()) host.animate([{ transform: cur }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
}

function initGestures(stage) {
  // Trackpad pinch and Ctrl + wheel arrive as wheel events with ctrlKey.
  let acc = 0, wheelTimer = null, lastAnchor = null;
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (busy) return;
    const unit = e.deltaMode === 1 ? 16 : 1;
    acc += e.deltaY * unit;
    lastAnchor = anchorAt(e.clientX, e.clientY);
    const T = 90;
    const lv = LEVELS.indexOf(ui.level);
    if ((acc < -T && lv === 0) || (acc > T && lv === LEVELS.length - 1)) acc = Math.sign(acc) * T;
    setLive(Math.exp(-acc / 260), lastAnchor.x, lastAnchor.y);
    if (acc <= -T || acc >= T) {
      const dir = acc < 0 ? -1 : 1;
      acc = 0;
      zoomBy(dir, dir < 0 ? lastAnchor : { x: lastAnchor.x, y: lastAnchor.y });
    }
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { acc = 0; snapBack(); }, 220);
  }, { passive: false });

  // Two-finger pinch on a touch screen.
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [x, y] = mid(e.touches);
      pinch = { d0: dist(e.touches), anchor: anchorAt(x, y) };
    }
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    if (busy) return;
    const ratio = dist(e.touches) / pinch.d0;
    setLive(Math.max(0.5, Math.min(1.8, ratio)), pinch.anchor.x, pinch.anchor.y);
    if (ratio > 1.32 || ratio < 0.76) {
      const dir = ratio > 1 ? -1 : 1;
      zoomBy(dir, pinch.anchor);
      pinch.d0 = dist(e.touches);
    }
  }, { passive: false });
  const end = (e) => { if (pinch && e.touches.length < 2) { pinch = null; snapBack(); } };
  stage.addEventListener('touchend', end);
  stage.addEventListener('touchcancel', end);
}

// ---------------------------------------------------------------- clicks

function onClick(e) {
  const ev = e.target.closest('[data-ev]');
  if (ev) { showEvent(ev.dataset.ev); return; }
  const mk = e.target.closest('[data-mark]');
  if (mk) { showMarks(mk.dataset.mark); return; }
  const pe = e.target.closest('[data-period]');
  if (pe) { showPeriod(pe.dataset.period); return; }
  const z = e.target.closest('[data-zoom]');
  if (z) { zoomTo(z.dataset.zoom, { ...anchorAt(e.clientX, e.clientY), day: z.dataset.day || z.closest('[data-day]')?.dataset.day }); return; }
  const d = e.target.closest('[data-day]');
  if (!d) return;
  if (ui.level === 'month') {
    if (ui.sel === d.dataset.day) { zoomTo('day', { ...anchorAt(e.clientX, e.clientY), day: d.dataset.day }); return; }
    ui.sel = d.dataset.day;
    render();
    return;
  }
  const into = { week: 'day', quarter: 'day', year: 'month', road: 'month' }[ui.level];
  if (into) zoomTo(into, { ...anchorAt(e.clientX, e.clientY), day: d.dataset.day });
}

// ---------------------------------------------------------------- pop-up

function pop(html) {
  const p = $('#calPop');
  p.innerHTML = '<div class="cal-card" role="dialog" aria-modal="true">' +
    '<button type="button" class="iconbtn cal-x" data-pop-close aria-label="Close">×</button>' + html + '</div>';
  p.hidden = false;
}
function closePop() { const p = $('#calPop'); if (p) { p.hidden = true; p.innerHTML = ''; } }

function whenText(o) {
  if (o.allDay) {
    const last = addDays(o.end, -1);
    return +last === +o.start ? dayName(o.start) : shortDay(o.start) + ' – ' + shortDay(last);
  }
  const sameDay = keyOf(o.start) === keyOf(o.end) || (+o.lastDay === +o.firstDay);
  return dayName(o.start) + ', ' + hm(o.start) + ' – ' + (sameDay ? '' : shortDay(o.end) + ' ') + hm(o.end);
}

function showEvent(id) {
  const it = data.get(id);
  if (!it) return;
  const o = occurrence(it, it.cal ? idx().cals.get(it.cal) : null);
  if (!o) return;
  const src = it.source === 'mail' ? 'Found in your email' : o.calName ? 'Calendar: ' + o.calName : '';
  const note = String(it.note || '').trim();
  const href = safeHref(it.url || '');
  pop('<p class="cal-pop-kicker c-' + o.color + '">' + (o.attention ? 'Needs attention' : 'Event') + '</p>' +
    '<h2>' + esc(o.title) + '</h2>' +
    '<p class="cal-when">' + esc(whenText(o)) + '</p>' +
    (it.location ? '<p class="muted">' + esc(it.location) + '</p>' : '') +
    (note ? '<p class="cal-note">' + esc(note.slice(0, 1200)) + '</p>' : '') +
    (src ? '<p class="hint">' + esc(src) + '</p>' : '') +
    (href ? '<p><a href="' + esc(href) + '" target="_blank" rel="noopener">Open the original</a></p>' : ''));
}

function showPeriod(id) {
  const p = idx().periods.find((x) => x.id === id);
  if (!p) return;
  const n = Math.round((p.end - p.start) / 864e5) + 1;
  pop('<p class="cal-pop-kicker c-' + p.color + '">' + esc(p.group || 'Period') + '</p><h2>' + esc(p.title) + '</h2>' +
    '<p class="cal-when">' + esc(+p.start === +p.end ? dayName(p.start) : shortDay(p.start) + ' – ' + shortDay(p.end) + ' ' + p.end.getFullYear()) +
    ' <span class="muted">(' + n + (n === 1 ? ' day' : ' days') + ')</span></p>' +
    (p.note ? '<p class="cal-note">' + esc(p.note) + '</p>' : ''));
}

// Everything marked on one day (road and year).
function showMarks(day) {
  const d = dayOf(day);
  if (!d) return;
  const rows = [];
  for (const h of holidaysOn(d)) rows.push('<li><span class="cal-dot hol' + (h.off ? ' off' : '') + '"></span>' + esc(h.name) + (h.off ? ' <span class="muted small">(public holiday)</span>' : '') + '</li>');
  for (const p of periodsOn(d)) rows.push('<li><button type="button" class="link" data-period-open="' + esc(p.id) + '"><span class="cal-dot c-' + p.color + '"></span>' + esc(p.title) + '</button></li>');
  for (const o of eventsOn(d)) rows.push('<li><button type="button" class="link" data-ev-open="' + esc(o.id) + '"><span class="cal-dot c-' + o.color + '"></span>' + esc(o.title) + '</button></li>');
  pop('<p class="cal-pop-kicker">' + esc(seasonName(d)) + '</p><h2>' + esc(dayName(d) + ' ' + d.getFullYear()) + '</h2>' +
    (rows.length ? '<ul class="cal-list plain">' + rows.join('') + '</ul>' : '<p class="muted">Nothing marked.</p>') +
    '<div class="row"><button type="button" class="quiet" data-pop-day="' + esc(day) + '">Open this day</button></div>');
  const p = $('#calPop');
  p.onclick = (e) => {
    const a = e.target.closest('[data-ev-open]'); if (a) { showEvent(a.dataset.evOpen); return; }
    const b = e.target.closest('[data-period-open]'); if (b) { showPeriod(b.dataset.periodOpen); return; }
    const c = e.target.closest('[data-pop-day]');
    if (c) { closePop(); const lv = ui.level; ui.focus = c.dataset.popDay; if (lv === 'day') render(); else zoomTo('day', { day: c.dataset.popDay }); }
  };
}
const seasonName = (d) => ({ winter: 'Winter', spring: 'Spring', summer: 'Summer', autumn: 'Autumn' })[seasonOf(d.getMonth() + 1)];

// ---------------------------------------------------------------- pieces

function chip(o, opts = {}) {
  const time = !o.allDay && opts.time ? '<span class="cal-t">' + hm(o.start) + '</span>' : '';
  return '<button type="button" class="cal-chip c-' + o.color + (o.allDay ? ' all' : '') + (o.attention ? ' att' : '') + '" data-ev="' + esc(o.id) + '" title="' + esc(o.title) + '">' +
    time + '<span class="cal-ct">' + esc(o.title) + '</span></button>';
}

function banners(d) {
  const out = [];
  for (const h of holidaysOn(d)) out.push('<span class="cal-ban hol' + (h.off ? ' off' : '') + '" data-mark="' + keyOf(d) + '">' + esc(h.name) + '</span>');
  for (const p of periodsOn(d)) out.push('<button type="button" class="cal-ban c-' + p.color + '" data-period="' + esc(p.id) + '">' + esc(p.title) + '</button>');
  return out.join('');
}

function agendaRow(o) {
  return '<li><button type="button" class="cal-arow" data-ev="' + esc(o.id) + '">' +
    '<span class="cal-atime">' + (o.allDay ? 'All day' : hm(o.start)) + '</span>' +
    '<span class="cal-dot c-' + o.color + '"></span>' +
    '<span class="cal-atitle">' + esc(o.title) + (o.attention ? ' <span class="cal-flag">!</span>' : '') + '</span></button></li>';
}

// Timed events of one day, laid out side by side where they overlap.
function lanes(list) {
  const out = [];
  let group = [], groupEnd = 0;
  const flush = () => {
    const cols = [];
    for (const o of group) {
      let c = cols.findIndex((end) => end <= o.start);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = o.end;
      out.push({ o, col: c });
    }
    for (const x of out.slice(out.length - group.length)) x.cols = cols.length;
    group = [];
  };
  for (const o of list) {
    if (group.length && o.start >= groupEnd) flush();
    group.push(o);
    groupEnd = Math.max(groupEnd, +o.end);
  }
  if (group.length) flush();
  return out;
}

function hourRange(days) {
  let from = 7, to = 22;
  for (const d of days) for (const o of eventsOn(d)) {
    if (o.allDay) continue;
    const s = +o.firstDay === +d ? o.start.getHours() : 0;
    const e = +o.lastDay === +d ? o.end.getHours() + (o.end.getMinutes() ? 1 : 0) : 24;
    from = Math.min(from, s); to = Math.max(to, e);
  }
  return [from, Math.min(24, to)];
}

function timeColumn(d, from, to, H) {
  const list = eventsOn(d).filter((o) => !o.allDay);
  const dayStart = +d, dayEnd = +addDays(d, 1);
  const blocks = lanes(list).map(({ o, col, cols }) => {
    const s = Math.max(+o.start, dayStart), e = Math.min(+o.end, dayEnd);
    const top = ((s - dayStart) / 3600e3 - from) * H;
    const h = Math.max(20, ((e - s) / 3600e3) * H - 2);
    return '<button type="button" class="cal-blk c-' + o.color + (o.attention ? ' att' : '') + '" data-ev="' + esc(o.id) + '" style="top:' + top.toFixed(1) + 'px;height:' + h.toFixed(1) + 'px;left:calc(' + (col / cols * 100) + '% + 2px);width:calc(' + (100 / cols) + '% - 4px)">' +
      '<span class="cal-t">' + hm(o.start) + '</span> <span class="cal-ct">' + esc(o.title) + '</span>' +
      (h > 44 && o.item.location ? '<span class="cal-loc">' + esc(o.item.location) + '</span>' : '') + '</button>';
  }).join('');
  let now = '';
  const n = new Date();
  if (keyOf(n) === keyOf(d)) {
    const y = (n.getHours() + n.getMinutes() / 60 - from) * H;
    if (y >= 0 && y <= (to - from) * H) now = '<span class="cal-now" style="top:' + y.toFixed(1) + 'px"></span>';
  }
  return '<div class="cal-col" data-day="' + keyOf(d) + '" style="height:' + ((to - from) * H) + 'px">' + blocks + now + '</div>';
}

function hourLabels(from, to, H) {
  let s = '';
  for (let h = from; h < to; h++) s += '<span style="top:' + ((h - from) * H) + 'px">' + pad(h) + ':00</span>';
  return '<div class="cal-hours" style="height:' + ((to - from) * H) + 'px">' + s + '</div>';
}

// ---------------------------------------------------------------- the levels

const VIEW = {
  day(f) {
    const all = eventsOn(f).filter((o) => o.allDay);
    const [from, to] = hourRange([f]);
    const H = 48;
    const empty = !eventsOn(f).length;
    return '<div class="cal-day" data-day="' + keyOf(f) + '">' +
      '<div class="cal-bans">' + banners(f) + '</div>' +
      (all.length ? '<div class="cal-alls">' + all.map((o) => chip(o)).join('') + '</div>' : '') +
      (empty ? '<p class="muted cal-empty">Nothing in the calendar this day.</p>' : '') +
      '<div class="cal-grid" style="--rows:' + (to - from) + ';--h:' + H + 'px">' + hourLabels(from, to, H) + timeColumn(f, from, to, H) + '</div>' +
      '</div>';
  },

  week(f, w) {
    const s = startOfWeek(f);
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(s, i));
    const t = keyOf(today());
    if (w < 700) {
      // a phone: the week as a list of days
      return '<ol class="cal-weeklist">' + days.map((d) => {
        const ev = eventsOn(d);
        return '<li class="cal-wday' + (keyOf(d) === t ? ' today' : '') + '" data-day="' + keyOf(d) + '">' +
          '<button type="button" class="cal-whead" data-zoom="day" data-day="' + keyOf(d) + '"><b>' + WD[wdIndex(d)] + '</b> ' + d.getDate() + '</button>' +
          '<div class="cal-wbody"><div class="cal-bans">' + banners(d) + '</div>' +
          (ev.length ? '<ul class="cal-list">' + ev.map(agendaRow).join('') + '</ul>' : '<span class="muted small">—</span>') + '</div></li>';
      }).join('') + '</ol>';
    }
    const [from, to] = hourRange(days);
    const H = 40;
    return '<div class="cal-week">' +
      '<div class="cal-wrow head"><span></span>' + days.map((d) =>
        '<button type="button" class="cal-whead' + (keyOf(d) === t ? ' today' : '') + '" data-zoom="day" data-day="' + keyOf(d) + '"><span>' + WD[wdIndex(d)] + '</span> <b>' + d.getDate() + '</b></button>').join('') + '</div>' +
      '<div class="cal-wrow alls"><span class="muted small">All day</span>' + days.map((d) =>
        '<div class="cal-wall" data-day="' + keyOf(d) + '">' + banners(d) + eventsOn(d).filter((o) => o.allDay).map((o) => chip(o)).join('') + '</div>').join('') + '</div>' +
      '<div class="cal-wrow grid" style="--h:' + H + 'px;--rows:' + (to - from) + '">' + hourLabels(from, to, H) + days.map((d) => timeColumn(d, from, to, H)).join('') + '</div>' +
      '</div>';
  },

  month(f, w) {
    const first = new Date(f.getFullYear(), f.getMonth(), 1);
    const start = startOfWeek(first);
    const t = keyOf(today());
    const wide = w >= 640;
    let cells = '';
    let d = start;
    for (let r = 0; r < 6; r++) {
      if (r > 0 && d.getMonth() !== f.getMonth()) break;
      cells += '<span class="cal-wk">' + isoWeek(d) + '</span>';
      for (let c = 0; c < 7; c++, d = addDays(d, 1)) {
        const k = keyOf(d);
        const ev = eventsOn(d);
        const hol = holidaysOn(d);
        const per = periodsOn(d);
        const off = hol.some((h) => h.off);
        const cls = ['cal-cell', d.getMonth() !== f.getMonth() ? 'out' : '', k === t ? 'today' : '', k === ui.sel ? 'sel' : '', off || c === 6 ? 'red' : ''].join(' ');
        const shade = per.length ? ' style="--shade:var(--c-' + per[0].color + ')"' : '';
        const max = wide ? 3 : 0;
        cells += '<div class="' + cls + (per.length ? ' shaded' : '') + '"' + shade + ' data-day="' + k + '" role="button" tabindex="0" aria-label="' + esc(dayName(d)) + (ev.length ? ', ' + ev.length + ' events' : '') + '">' +
          '<span class="cal-n">' + d.getDate() + '</span>' +
          (hol.length && wide ? '<span class="cal-hname' + (hol[0].off ? ' off' : '') + '">' + esc(hol[0].name) + '</span>' : '') +
          (wide ? ev.slice(0, max).map((o) => chip(o, { time: true })).join('') + (ev.length > max ? '<span class="cal-more">+' + (ev.length - max) + ' more</span>' : '')
                : '<span class="cal-dots">' + ev.slice(0, 4).map((o) => '<i class="c-' + o.color + '"></i>').join('') + '</span>') +
          '</div>';
      }
    }
    const head = '<span class="cal-wk"></span>' + WD.map((x, i) => '<span class="cal-wdn' + (i === 6 ? ' red' : '') + '">' + x + '</span>').join('');
    // under the grid: the chosen day, or what is coming up
    let below;
    const sd = dayOf(ui.sel);
    if (sd) {
      const ev = eventsOn(sd);
      below = '<h3 class="cal-sub"><button type="button" class="link" data-zoom="day" data-day="' + ui.sel + '">' + esc(dayName(sd)) + ' ›</button></h3>' +
        '<div class="cal-bans">' + banners(sd) + '</div>' +
        (ev.length ? '<ul class="cal-list">' + ev.map(agendaRow).join('') + '</ul>' : '<p class="muted small">Nothing in the calendar. Tap the day again to open it.</p>');
    } else {
      below = upcoming(first, addMonths(first, 1));
    }
    return '<div class="cal-month' + (wide ? ' wide' : '') + '"><div class="cal-mgrid">' + head + cells + '</div></div><div class="cal-below">' + below + '</div>';
  },

  quarter(f, w) {
    const s = quarterStart(f);
    const months = [0, 1, 2].map((i) => addMonths(s, i));
    return '<div class="cal-quarter">' + months.map((m) => mini(m, { big: true })).join('') + '</div>' +
      '<div class="cal-below">' + highlights(s, addMonths(s, 3)) + '</div>';
  },

  year(f, w) {
    const y = f.getFullYear();
    const months = [];
    for (let i = 0; i < 12; i++) months.push(new Date(y, i, 1));
    return '<div class="cal-year">' + months.map((m) => mini(m, {})).join('') + '</div>' + legend(y);
  },

  road(f, w) {
    return '<div class="cal-road">' + legend(today().getFullYear(), true) + roadSvg(w) + '<div class="cal-road-more" aria-hidden="true"></div></div>';
  },
};

// A small month: used by the quarter and the year.
function mini(m, opts) {
  const start = startOfWeek(m);
  const t = keyOf(today());
  let cells = WD.map((x) => '<span class="cal-mh">' + x[0] + '</span>').join('');
  let d = start;
  for (let r = 0; r < 6; r++) {
    if (r > 0 && d.getMonth() !== m.getMonth()) break;
    for (let c = 0; c < 7; c++, d = addDays(d, 1)) {
      if (d.getMonth() !== m.getMonth()) { cells += '<span class="cal-mc blank"></span>'; continue; }
      const k = keyOf(d);
      const hol = holidaysOn(d);
      const per = periodsOn(d);
      const ev = eventsOn(d);
      const att = ev.some((o) => o.attention || o.mark);
      const cls = 'cal-mc' + (k === t ? ' today' : '') + (hol.some((h) => h.off) || c === 6 ? ' red' : '') + (per.length ? ' shaded' : '') + (att ? ' att' : '');
      cells += '<span class="' + cls + '" data-day="' + k + '"' + (per.length ? ' style="--shade:var(--c-' + per[0].color + ')"' : '') +
        (hol.length || per.length ? ' title="' + esc([...hol.map((h) => h.name), ...per.map((p) => p.title)].join(', ')) + '"' : '') + '>' + d.getDate() +
        (ev.length ? '<i class="c-' + ev[0].color + '"></i>' : '') + '</span>';
    }
  }
  return '<section class="cal-mini season-' + seasonOf(m.getMonth() + 1) + (opts.big ? ' big' : '') + '" data-day="' + keyOf(m) + '">' +
    '<button type="button" class="cal-mname" data-zoom="month" data-day="' + keyOf(m) + '">' + MONTHS[m.getMonth()] + (opts.big ? ' ' + m.getFullYear() : '') + '</button>' +
    '<div class="cal-mgrid mini">' + cells + '</div></section>';
}

// The period colours and what they mean.
function legend(year, withSeasons) {
  const { groups, periods } = idx();
  const items = [];
  if (withSeasons) for (const s of ['winter', 'spring', 'summer', 'autumn']) items.push('<span class="cal-leg"><i class="season-' + s + '"></i>' + seasonName(new Date(2000, { winter: 0, spring: 3, summer: 6, autumn: 9 }[s], 1)) + '</span>');
  items.push('<span class="cal-leg"><i class="hol off"></i>Public holiday</span>');
  for (const g of groups) {
    const p = periods.find((x) => x.group === g);
    items.push('<span class="cal-leg"><i class="c-' + p.color + '"></i>' + esc(g || 'Periods') + '</span>');
  }
  return '<div class="cal-legend">' + items.join('') + '</div>';
}

// Holidays, periods and marked events between two dates, for the quarter.
function highlights(from, to) {
  const rows = [];
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    for (const h of holidays(y, COUNTRY)) {
      const d = dayOf(h.date);
      if (d >= from && d < to && h.off) rows.push({ d, html: '<span class="cal-dot hol off"></span>' + esc(h.name), key: h.date, mark: true });
    }
  }
  for (const p of idx().periods) if (p.end >= from && p.start < to) rows.push({ d: p.start, html: '<span class="cal-dot c-' + p.color + '"></span>' + esc(p.title) + ' <span class="muted small">to ' + esc(shortDay(p.end)) + '</span>', period: p.id });
  for (const o of idx().marks) if (o.firstDay >= from && o.firstDay < to) rows.push({ d: o.firstDay, html: '<span class="cal-dot c-' + o.color + '"></span>' + esc(o.title) + (o.attention ? ' <span class="cal-flag">!</span>' : ''), ev: o.id });
  rows.sort((a, b) => a.d - b.d);
  if (!rows.length) return '';
  return '<h3 class="cal-sub">Marked in these months</h3><ul class="cal-list">' + rows.map((r) =>
    '<li><button type="button" class="cal-arow" ' + (r.ev ? 'data-ev="' + esc(r.ev) + '"' : r.period ? 'data-period="' + esc(r.period) + '"' : 'data-mark="' + r.key + '"') + '>' +
    '<span class="cal-atime">' + esc(shortDay(r.d)) + '</span><span class="cal-atitle">' + r.html + '</span></button></li>').join('') + '</ul>';
}

function upcoming(from, to) {
  const t = today();
  const start = from < t && to > t ? t : from;
  const seen = new Set();
  const rows = [];
  for (let d = start; d < to && rows.length < 12; d = addDays(d, 1)) {
    for (const o of eventsOn(d)) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      rows.push('<li><button type="button" class="cal-arow" data-ev="' + esc(o.id) + '"><span class="cal-atime">' + esc(shortDay(d)) + (o.allDay ? '' : ' ' + hm(o.start)) + '</span>' +
        '<span class="cal-dot c-' + o.color + '"></span><span class="cal-atitle">' + esc(o.title) + (o.attention ? ' <span class="cal-flag">!</span>' : '') + '</span></button></li>');
    }
  }
  if (!rows.length) return idx().byDay.size ? '' : '<p class="muted small cal-empty">No events yet. Claude fills this in from your calendars and email.</p>';
  return '<h3 class="cal-sub">' + (start === t ? 'Coming up' : 'This month') + '</h3><ul class="cal-list">' + rows.join('') + '</ul>';
}

// ---------------------------------------------------------------- the road

// The years drawn as one road that winds back and forth down the page:
// each row is a few months, a half circle turns it into the next row.
// Colours of the road are the seasons; dots above it are holidays and
// marked events; bands below it are periods.
export function roadLayout(w) {
  const narrow = w < 640;
  const per = narrow ? 3 : 4;               // months per row
  const H = narrow ? 118 : 150;             // row height
  const r = H / 2;
  const m = r + 6;                          // room for the turns
  const L = Math.max(120, w - 2 * m);
  return { per, rows: 12 / per, H, r, m, L, w, top: 54 };
}

function roadPoint(lay, y0, d) {
  const y = d.getFullYear(), mo = d.getMonth();
  const row = Math.floor(mo / lay.per);
  const rs = new Date(y, row * lay.per, 1), re = new Date(y, row * lay.per + lay.per, 1);
  const t = (d - rs) / (re - rs);
  const g = (y - y0) * lay.rows + row;
  const ltr = g % 2 === 0;
  return { x: ltr ? lay.m + t * lay.L : lay.w - lay.m - t * lay.L, y: lay.top + g * lay.H, g, ltr };
}

function roadSvg(w) {
  const lay = roadLayout(w);
  const y0 = today().getFullYear();
  const years = roadYears;
  const totalRows = years * lay.rows;
  const height = lay.top + totalRows * lay.H + 30;
  const t = today();
  const parts = [];
  const above = new Map(), below = new Map();     // labels placed per row, to avoid overlaps
  const place = (map, g, x, width) => {
    const l = map.get(g) || [];
    if (l.some(([a, b]) => x < b + 6 && x + width > a - 6)) return false;
    l.push([x, x + width]); map.set(g, l); return true;
  };
  const tw = (s, px) => s.length * px * 0.56 + 4;

  // the road, row by row and season by season, with the turns
  for (let g = 0; g < totalRows; g++) {
    const y = lay.top + g * lay.H;
    const ltr = g % 2 === 0;
    const year = y0 + Math.floor(g / lay.rows);
    const row = g % lay.rows;
    for (let k = 0; k < lay.per; k++) {
      const mo = row * lay.per + k;
      const a = roadPoint(lay, y0, new Date(year, mo, 1));
      const bx = ltr ? a.x + lay.L / lay.per : a.x - lay.L / lay.per;
      const past = new Date(year, mo + 1, 1) <= t;
      parts.push('<line class="rd season-' + seasonOf(mo + 1) + (past ? ' past' : '') + '" x1="' + a.x.toFixed(1) + '" y1="' + y + '" x2="' + bx.toFixed(1) + '" y2="' + y + '"/>');
      const mx = (a.x + bx) / 2;
      parts.push('<text class="rd-month' + (past ? ' past' : '') + '" x="' + mx.toFixed(1) + '" y="' + (y + 4) + '" data-day="' + keyOf(new Date(year, mo, 1)) + '" data-zoom="month">' + MONTHS[mo].slice(0, 3).toUpperCase() + '</text>');
      if (k > 0) parts.push('<line class="rd-tick" x1="' + a.x.toFixed(1) + '" y1="' + (y - 9) + '" x2="' + a.x.toFixed(1) + '" y2="' + (y + 9) + '"/>');
    }
    if (g < totalRows - 1) {
      const xe = ltr ? lay.w - lay.m : lay.m;
      const nextMo = (row * lay.per + lay.per) % 12;
      parts.push('<path class="rd season-' + seasonOf(nextMo === 0 ? 12 : nextMo) + '" d="M' + xe + ' ' + y + ' A' + lay.r + ' ' + lay.r + ' 0 0 ' + (ltr ? 1 : 0) + ' ' + xe + ' ' + (y + lay.H) + '"/>');
    }
  }

  // the years: a flag where each one starts
  for (let i = 0; i < years; i++) {
    const p = roadPoint(lay, y0, new Date(y0 + i, 0, 1));
    parts.push('<text class="rd-year" x="' + (p.ltr ? p.x : p.x) + '" y="' + (p.y - 30) + '" text-anchor="' + (p.ltr ? 'start' : 'end') + '">' + (y0 + i) + '</text>');
    place(above, p.g, p.ltr ? p.x : p.x - 44, 44);
  }

  // periods: bands under the road, one lane per group
  const { periods, marks } = idx();
  const end = new Date(y0 + years, 0, 1);
  for (const p of periods) {
    if (p.end < new Date(y0, 0, 1) || p.start >= end) continue;
    // split at row edges
    let s = p.start < new Date(y0, 0, 1) ? new Date(y0, 0, 1) : p.start;
    const last = p.end >= end ? addDays(end, -1) : p.end;
    let first = true;
    while (s <= last) {
      const row = Math.floor(s.getMonth() / lay.per);
      const rowEnd = addDays(new Date(s.getFullYear(), row * lay.per + lay.per, 1), -1);
      const e = last < rowEnd ? last : rowEnd;
      const a = roadPoint(lay, y0, s), b = roadPoint(lay, y0, addDays(e, 1));
      const bx = (+addDays(e, 1) === +new Date(s.getFullYear(), row * lay.per + lay.per, 1)) ? (a.ltr ? lay.w - lay.m : lay.m) : b.x;
      const x1 = Math.min(a.x, bx), x2 = Math.max(a.x, bx);
      const yy = a.y + 14 + p.lane * 7;
      parts.push('<rect class="rd-per c-' + p.color + '" x="' + x1.toFixed(1) + '" y="' + yy + '" width="' + Math.max(3, x2 - x1).toFixed(1) + '" height="5" rx="2.5" data-period="' + esc(p.id) + '"><title>' + esc(p.title) + '</title></rect>');
      if (first) {
        const label = p.title;
        const lx = x1, ly = a.y + 14 + idx().groups.length * 7 + 10;
        if (place(below, a.g, lx, tw(label, 10.5))) parts.push('<text class="rd-plabel c-' + p.color + '" x="' + lx.toFixed(1) + '" y="' + ly + '" data-period="' + esc(p.id) + '">' + esc(label) + '</text>');
        first = false;
      }
      s = addDays(e, 1);
    }
  }

  // holidays and marked events: dots on the road, names above it
  const dots = [];
  for (let i = 0; i < years; i++) {
    const seen = new Set();
    for (const h of holidays(y0 + i, COUNTRY)) {
      const d = dayOf(h.date);
      const grp = h.group;
      const label = seen.has(grp) ? '' : (holidays(y0 + i, COUNTRY).filter((x) => x.group === grp).length > 1 ? grp : h.name);
      seen.add(grp);
      dots.push({ d, cls: 'hol' + (h.off ? ' off' : ''), label, prio: h.off ? 2 : 0 });
    }
  }
  for (const o of marks) if (o.firstDay >= new Date(y0, 0, 1) && o.firstDay < end) dots.push({ d: o.firstDay, cls: 'ev c-' + o.color, label: o.title, prio: 3 });
  dots.sort((a, b) => b.prio - a.prio || a.d - b.d);
  for (const dt of dots) {
    const p = roadPoint(lay, y0, new Date(+dt.d + 432e5));
    const past = dt.d < t;
    parts.push('<circle class="rd-dot ' + dt.cls + (past ? ' past' : '') + '" cx="' + p.x.toFixed(1) + '" cy="' + (p.y - 9) + '" r="' + (dt.prio >= 2 ? 4.2 : 3) + '" data-mark="' + keyOf(dt.d) + '"/>');
    if (dt.label) {
      const width = tw(dt.label, 10.5);
      const lx = p.x - width / 2;
      if (place(above, p.g, lx, width)) {
        parts.push('<text class="rd-label ' + dt.cls + (past ? ' past' : '') + '" x="' + p.x.toFixed(1) + '" y="' + (p.y - 19) + '" text-anchor="middle" data-mark="' + keyOf(dt.d) + '">' + esc(dt.label) + '</text>');
      }
    }
  }

  // today
  const tp = roadPoint(lay, y0, new Date(+t + 432e5));
  parts.push('<g class="rd-today" data-mark="' + keyOf(t) + '"><circle cx="' + tp.x.toFixed(1) + '" cy="' + tp.y + '" r="9"/><circle class="in" cx="' + tp.x.toFixed(1) + '" cy="' + tp.y + '" r="4"/></g>');

  return '<svg class="road" viewBox="0 0 ' + w + ' ' + height + '" width="' + w + '" height="' + height + '" role="img" aria-label="The years ahead as a road, with seasons, holidays and periods">' + parts.join('') + '</svg>';
}

let roadObserver = null;
function watchRoad(host) {
  if (roadObserver) roadObserver.disconnect();
  const more = host.querySelector('.cal-road-more');
  if (!more || typeof IntersectionObserver === 'undefined') return;
  roadObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && roadYears < 30 && ui.level === 'road' && !busy) {
      roadYears += 3;
      const svg = host.querySelector('svg.road');
      if (svg) svg.outerHTML = roadSvg($('#calStage').clientWidth);
    }
  }, { rootMargin: '400px' });
  roadObserver.observe(more);
}

function scrollToFocus() {
  setTimeout(() => {
    const svg = $('#calStage svg.road');
    if (!svg) return;
    const lay = roadLayout($('#calStage').clientWidth);
    const f = focus();
    const y0 = today().getFullYear();
    if (f.getFullYear() < y0) return;
    if (f.getFullYear() >= y0 + roadYears) { roadYears = f.getFullYear() - y0 + 2; svg.outerHTML = roadSvg($('#calStage').clientWidth); }
    const p = roadPoint(lay, y0, f);
    const top = $('#calStage svg.road').getBoundingClientRect().top + window.scrollY + p.y - innerHeight / 3;
    if (top > innerHeight / 2) window.scrollTo({ top, behavior: reduced() ? 'auto' : 'smooth' });
  }, 340);
}
function scrollToToday() { ui.focus = keyOf(today()); scrollToFocus(); }
