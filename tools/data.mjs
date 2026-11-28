#!/usr/bin/env node
// Claude's door to Ebbe's data, mail and calendars, through his gateway
// script (gateway/gateway.gs). For Claude's own sessions only; the app has its
// own code in js/data.js.
//
// Needs two environment variables, set in the Claude task's environment
// settings (never in this repo, never on his devices):
//   DASHBOARD_GATEWAY_URL   the gateway's Web app address (ends in /exec)
//   DASHBOARD_GATEWAY_KEY   the gateway's CLAUDE key
//
// Data is written to DASHBOARD_DATA_DIR (default ~/dashboard-data), which
// must be OUTSIDE the repo: Ebbe's data must never be committed.
//
//   node tools/data.mjs ping
//   node tools/data.mjs pull                     all items -> $DIR/workspace.json, prints a summary
//   node tools/data.mjs push FILE                FILE: a JSON list of whole items (or { "items": [...] })
//   node tools/data.mjs file-get ID              a picture sent with an Ask Claude message -> $DIR/files/, prints its path
//   node tools/data.mjs mail-search "QUERY" [MAX]   Gmail search syntax, e.g. "newer_than:1d"
//   node tools/data.mjs mail-get ID
//   node tools/data.mjs calendars
//   node tools/data.mjs events [CALENDAR_ID|primary] [FROM] [TO]   ISO dates; default: the next 7 days
//   node tools/data.mjs event-put FILE|JSON      { id?, title, start, end?, allDay?, description?, location? }
//   node tools/data.mjs event-delete ID          (Dashboard calendar only)
//   node tools/data.mjs calendar-sync [DAYS]     copies events from his calendars into the workspace (see below)
//
// calendar-sync: every item of kind "calendar" with a calendarId is a
// calendar to copy (add or remove such items to choose; "hidden: true" only
// hides it in the app). Its events from 31 days ago to DAYS ahead (default
// 400) become items of kind "event" (source "calendar"); changed ones are
// updated, ones gone from the calendar are deleted. Events Claude adds from
// mail (source "mail") are left alone.
//
// Push sends whole items. Start from the copy in workspace.json, change what
// you need, and keep id and kind. updatedAt is set here, newer than the copy
// you pulled, so your change wins over that copy but never over a newer one
// Ebbe made meanwhile (that one comes back and is kept). Delete with a
// tombstone: { "id": "...", "kind": "...", "deleted": true }.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.DASHBOARD_GATEWAY_URL || '';
const KEY = process.env.DASHBOARD_GATEWAY_KEY || '';
const DIR = resolve(process.env.DASHBOARD_DATA_DIR || join(homedir(), 'dashboard-data'));

function fail(msg) { console.error(msg); process.exit(1); }

if (DIR === REPO || DIR.startsWith(REPO + sep)) {
  fail('DASHBOARD_DATA_DIR is inside the repo (' + DIR + '). Ebbe\'s data must never be in the repo; use a folder outside it.');
}

async function call(body) {
  if (!URL_ || !KEY) {
    fail('DASHBOARD_GATEWAY_URL and DASHBOARD_GATEWAY_KEY are not set in this environment. ' +
      'Ebbe adds them in the Claude task\'s environment settings (README, "Let Claude reach the data").');
  }
  const payload = JSON.stringify({ ...body, key: KEY });
  let raw;
  try {
    // curl follows the gateway's redirect the way Apps Script expects (POST, then GET)
    // and uses the environment's proxy settings. The key goes in on stdin, not
    // on the command line.
    raw = execFileSync('curl', ['-sS', '-L', '--max-time', '120', '-H', 'Content-Type: text/plain;charset=utf-8',
      '--data-binary', '@-', URL_], { input: payload, maxBuffer: 256 * 1024 * 1024 }).toString();
  } catch (e) {
    if (e.code === 'ENOENT') {
      const res = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload, redirect: 'follow' });
      raw = await res.text();
    } else {
      fail('Could not reach the gateway: ' + String(e.stderr || e.message).trim() +
        '\nIf this is a network block, the Claude task\'s environment must allow script.google.com and script.googleusercontent.com.');
    }
  }
  let j;
  try { j = JSON.parse(raw); } catch (e) { fail('The gateway did not answer with JSON. First part of the answer:\n' + raw.slice(0, 300)); }
  if (!j.ok) fail('The gateway refused: ' + j.error);
  return j;
}

const print = (x) => console.log(JSON.stringify(x, null, 2));
const ws = () => join(DIR, 'workspace.json');

function readJSONArg(arg) {
  if (!arg) fail('Missing argument.');
  return JSON.parse(existsSync(arg) ? readFileSync(arg, 'utf8') : arg);
}

function summary(items) {
  const live = items.filter((it) => !it.deleted);
  const byKind = {};
  for (const it of live) byKind[it.kind] = (byKind[it.kind] || 0) + 1;
  const types = new Map(live.filter((it) => it.kind === 'type').map((t) => [t.id, t.name || t.id]));
  const byType = {};
  for (const it of live) if (it.kind === 'record') { const n = types.get(it.type) || it.type || '(no type)'; byType[n] = (byType[n] || 0) + 1; }
  return { items: live.length, byKind, recordsByType: byType };
}

const [cmd, a1, a2, a3] = process.argv.slice(2);

switch (cmd) {
  case 'ping': print(await call({ action: 'ping' })); break;

  case 'pull': {
    const j = await call({ action: 'pull', since: 0 });
    mkdirSync(DIR, { recursive: true });
    writeFileSync(ws(), JSON.stringify({ rev: j.rev, pulledAt: Date.now(), items: j.items }, null, 1));
    print({ wrote: ws(), rev: j.rev, ...summary(j.items) });
    break;
  }

  case 'push': {
    let list = readJSONArg(a1);
    if (!Array.isArray(list)) list = list.items;
    if (!Array.isArray(list) || !list.length) fail('Nothing to push: give a JSON list of whole items.');
    let base = new Map();
    if (existsSync(ws())) base = new Map(JSON.parse(readFileSync(ws(), 'utf8')).items.map((it) => [it.id, it]));
    let t = Date.now();
    const items = list.map((it) => {
      if (!it.id || !it.kind) fail('Every item needs an id and a kind: ' + JSON.stringify(it).slice(0, 120));
      const prev = base.get(it.id);
      const updatedAt = Math.max(t++, prev ? (prev.updatedAt || 0) + 1 : 0);
      const out = { ...it, updatedAt };
      delete out.rev;
      return out;
    });
    const j = await call({ action: 'push', since: 0, items });
    if (existsSync(ws())) {
      const merged = new Map(base);
      for (const it of j.items) merged.set(it.id, it);
      writeFileSync(ws(), JSON.stringify({ rev: j.rev, pulledAt: Date.now(), items: [...merged.values()] }, null, 1));
    }
    const refused = items.filter((it) => !j.accepted.includes(it.id)).map((it) => it.id);
    print({ rev: j.rev, accepted: j.accepted.length, refusedBecauseNewerOnDrive: refused });
    break;
  }

  case 'file-get': {
    if (!a1) fail('file-get needs the picture\'s id (it is in the Ask Claude message).');
    const { file } = await call({ action: 'fileGet', id: a1 });
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif' }[file.mimeType] || '';
    const dir = join(DIR, 'files');
    mkdirSync(dir, { recursive: true });
    const out = join(dir, String(file.id).replace(/[^\w-]/g, '_') + ext);
    writeFileSync(out, Buffer.from(file.data, 'base64'));
    print({ wrote: out, name: file.name, mimeType: file.mimeType, size: file.size });
    break;
  }

  case 'mail-search': print(await call({ action: 'mailSearch', q: a1 || '', max: Number(a2) || 20 })); break;
  case 'mail-get': print(await call({ action: 'mailGet', id: a1 })); break;
  case 'calendars': print(await call({ action: 'calendars' })); break;
  case 'events': print(await call({ action: 'events', calendarId: a1 || 'primary', from: a2, to: a3 })); break;
  case 'event-put': print(await call({ action: 'eventPut', event: readJSONArg(a1) })); break;
  case 'event-delete': print(await call({ action: 'eventDelete', id: a1 })); break;

  case 'calendar-sync': {
    const days = Number(a1) || 400;
    const j = await call({ action: 'pull', since: 0 });
    const live = j.items.filter((it) => !it.deleted);
    const cals = live.filter((it) => it.kind === 'calendar' && it.calendarId);
    if (!cals.length) fail('No calendar items with a calendarId in the workspace yet: add one per calendar to copy.');
    const from = new Date(Date.now() - 31 * 864e5), to = new Date(Date.now() + days * 864e5);
    const old = new Map(live.filter((it) => it.kind === 'event' && it.source === 'calendar').map((it) => [it.id, it]));
    const keep = new Set();
    const out = [];
    const FIELDS = ['title', 'start', 'end', 'allDay', 'location', 'note', 'url', 'cal'];
    const report = {};
    for (const c of cals) {
      let n = 0;
      // the whole window at once; split it in two when an answer is full
      const fetchRange = async (s, e) => {
        const r = await call({ action: 'events', calendarId: c.calendarId, from: s.toISOString(), to: e.toISOString(), max: 250 });
        if (r.events.length < 250 || e - s < 2 * 864e5) return r.events;
        const mid = new Date((+s + +e) / 2);
        return [...await fetchRange(s, mid), ...await fetchRange(mid, e)];
      };
      for (const ev of await fetchRange(from, to)) {
        if (ev.status === 'cancelled') continue;
        const id = 'ev-' + createHash('sha1').update(c.calendarId + '|' + ev.id).digest('hex').slice(0, 16);
        if (keep.has(id)) continue;              // seen in both halves
        keep.add(id);
        n++;
        const item = { id, kind: 'event', source: 'calendar', cal: c.id, title: ev.title, start: ev.start, end: ev.end,
          allDay: !!ev.allDay, location: ev.location || '', note: String(ev.description || '').slice(0, 2000), url: ev.link || '' };
        const prev = old.get(id);
        if (prev && FIELDS.every((k) => JSON.stringify(prev[k] ?? '') === JSON.stringify(item[k] ?? ''))) continue;
        out.push(prev ? { ...prev, ...item } : item);
      }
      report[c.name || c.calendarId] = n;
    }
    // gone from a calendar that is still copied, inside the window: delete
    const copied = new Set(cals.map((c) => c.id));
    for (const it of old.values()) {
      if (keep.has(it.id) || !copied.has(it.cal)) continue;
      const t = new Date(it.start);
      if (t >= from && t < to) out.push({ id: it.id, kind: 'event', deleted: true });
    }
    // events of calendars no longer copied
    for (const it of old.values()) if (!copied.has(it.cal)) out.push({ id: it.id, kind: 'event', deleted: true });
    let t = Date.now();
    const items = out.map((it) => ({ ...it, updatedAt: Math.max(t++, (old.get(it.id)?.updatedAt || 0) + 1) }));
    for (const it of items) delete it.rev;
    let accepted = 0;
    for (let i = 0; i < items.length; i += 200) {
      const r = await call({ action: 'push', since: 0, items: items.slice(i, i + 200) });
      accepted += r.accepted.length;
    }
    print({ calendars: report, changed: items.filter((x) => !x.deleted).length, deleted: items.filter((x) => x.deleted).length, accepted });
    break;
  }

  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(cmd ? 1 : 0);
}
