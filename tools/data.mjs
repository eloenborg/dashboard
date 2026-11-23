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
//   node tools/data.mjs mail-search "QUERY" [MAX]   Gmail search syntax, e.g. "newer_than:1d"
//   node tools/data.mjs mail-get ID
//   node tools/data.mjs calendars
//   node tools/data.mjs events [CALENDAR_ID|primary] [FROM] [TO]   ISO dates; default: the next 7 days
//   node tools/data.mjs event-put FILE|JSON      { id?, title, start, end?, allDay?, description?, location? }
//   node tools/data.mjs event-delete ID          (Dashboard calendar only)
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

  case 'mail-search': print(await call({ action: 'mailSearch', q: a1 || '', max: Number(a2) || 20 })); break;
  case 'mail-get': print(await call({ action: 'mailGet', id: a1 })); break;
  case 'calendars': print(await call({ action: 'calendars' })); break;
  case 'events': print(await call({ action: 'events', calendarId: a1 || 'primary', from: a2, to: a3 })); break;
  case 'event-put': print(await call({ action: 'eventPut', event: readJSONArg(a1) })); break;
  case 'event-delete': print(await call({ action: 'eventDelete', id: a1 })); break;

  default:
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(cmd ? 1 : 0);
}
