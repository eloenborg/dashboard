#!/usr/bin/env node
// Checks the app before it is pushed. Plain Node, no dependencies.
// GitHub Actions runs this too, and refuses to publish when it fails.
//
//   node tests/run.mjs
//
// Prints one line per check and "N passed, 0 failed"; exits 1 on any failure.

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.message || e).replace(/\n/g, '\n     ')); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// Every file in the repo except .git, as paths relative to ROOT.
function allFiles(dir = ROOT) {
  return readdirSync(dir).flatMap((name) => {
    if (name === '.git' || name === 'node_modules') return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? allFiles(p) : [relative(ROOT, p)];
  });
}
const jsFiles = readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f);

// ---------- syntax ----------

await check('every js/*.js file parses as a module', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'dash-'));
  for (const f of jsFiles) {
    const copy = join(tmp, f.replace(/\//g, '_') + '.mjs');
    writeFileSync(copy, read(f));
    try { execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }); }
    catch (e) { throw new Error(f + ': ' + String(e.stderr || e.message).split('\n').slice(0, 5).join('\n')); }
  }
});

await check('sw.js and the Apps Scripts parse as scripts', () => {
  for (const f of ['sw.js', 'ask-claude/relay.gs', 'gateway/gateway.gs']) {
    try { new vm.Script(read(f), { filename: f }); }
    catch (e) { throw new Error(f + ': ' + e.message); }
  }
});

// ---------- files and references ----------

await check('the version is a whole number', () => {
  must(/^export const BUILD = \d+;$/m.test(read('js/version.js')), 'js/version.js must contain "export const BUILD = <number>;"');
});

await check('every file the page, manifest, styles and scripts point to exists', () => {
  const missing = [];
  const local = (u) => u && !/^(https?:|data:|#|mailto:|claude:)/.test(u);
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (local(m[1]) && !existsSync(join(ROOT, m[1]))) missing.push('index.html → ' + m[1]);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const icon of manifest.icons) if (!existsSync(join(ROOT, icon.src))) missing.push('manifest → ' + icon.src);
  for (const m of read('style.css').matchAll(/url\('([^']+)'\)/g)) if (local(m[1]) && !existsSync(join(ROOT, m[1]))) missing.push('style.css → ' + m[1]);
  for (const f of jsFiles) {
    for (const m of read(f).matchAll(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g)) {
      if (!existsSync(join(ROOT, 'js', m[1]))) missing.push(f + ' → ' + m[1]);
    }
  }
  must(!missing.length, 'missing: ' + missing.join(', '));
});

await check('every #id the scripts look up exists in index.html', () => {
  const ids = new Set([...read('index.html').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const missing = [];
  for (const f of jsFiles) {
    for (const m of read(f).matchAll(/\$\('#([\w-]+)'\)/g)) if (!ids.has(m[1])) missing.push(f + ' → #' + m[1]);
  }
  must(!missing.length, 'not in index.html: ' + missing.join(', '));
});

// ---------- the repo is public: no secrets, no relay addresses ----------

await check('no keys, tokens or relay addresses are committed', () => {
  const patterns = [
    [/sk-ant-[a-z0-9]+-[A-Za-z0-9_-]{20,}/, 'an Anthropic token'],
    [/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/, 'a real Apps Script address'],
    [/routines\/trig_[A-Za-z0-9]{10,}/, 'a real Claude task address'],
    [/AIza[0-9A-Za-z_-]{30,}/, 'a Google API key'],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
    [/github_pat_[A-Za-z0-9_]{30,}/, 'a GitHub token'],
  ];
  const hits = [];
  for (const f of allFiles()) {
    if (/\.(png|woff2|ico|jpg|jpeg|gif|webp)$/i.test(f)) continue;
    const text = read(f);
    for (const [re, what] of patterns) if (re.test(text)) hits.push(f + ': looks like ' + what);
  }
  must(!hits.length, hits.join('\n'));
});

// ---------- Ask Claude ----------

// Minimal browser stand-ins so the modules can load in Node.
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
globalThis.document = { dispatchEvent() {}, addEventListener() {} };
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.matchMedia = globalThis.window.matchMedia;
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5, onLine: true },
  configurable: true,
});
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };

const ask = await import(pathToFileURL(join(ROOT, 'js/ask.js')).href);
const store = await import(pathToFileURL(join(ROOT, 'js/store.js')).href);
const { BUILD } = await import(pathToFileURL(join(ROOT, 'js/version.js')).href);
const config = await import(pathToFileURL(join(ROOT, 'js/config.js')).href);

await check('the message to Claude says who, when, which version, then the text', () => {
  const msg = ask.messageFor('Add a clock', new Date('2026-11-23T12:05:00Z'));
  const lines = msg.split('\n');
  must(lines[0].includes('Ask Claude message from ' + config.OWNER), 'first line: ' + lines[0]);
  must(lines[0].includes(config.REPO), 'first line should name the repo');
  must(lines[1].includes('13:05') && lines[1].includes('Copenhagen'), 'time should be 13:05 Copenhagen time: ' + lines[1]);
  must(lines[1].includes('v' + BUILD), 'should name the app version');
  must(lines[1].includes('iPhone'), 'should name the device');
  must(lines.at(-1) === 'Add a clock', 'the message itself comes last');
});

await check('the fallback link opens the Claude app with message, repo and branch', () => {
  const link = ask.claudeAppLink('Add a clock');
  must(link.startsWith('claude://code/new?'), 'on a phone it should be a claude:// link: ' + link.slice(0, 40));
  const q = new URLSearchParams(link.split('?')[1]);
  must(q.get('repo') === config.REPO && q.get('branch') === config.BRANCH, 'repo/branch wrong');
  must(q.get('q').endsWith('Add a clock'), 'message missing');
});

await check('the relay address and passphrase never end up in an export', () => {
  ask.setAskConfig({ url: 'https://script.google.com/macros/s/EXAMPLE/exec', pass: 'example-pass' });
  must(ask.isConnected(), 'should count as connected');
  const exported = store.exportJSON();
  must(!exported.includes('example-pass') && !exported.includes('/exec'), 'export contains the relay settings');
  ask.setAskConfig({});
  must(!ask.isConnected(), 'forget should disconnect');
});

await check('the relay protocol: ask sends the passphrase and the message, ping checks readiness', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    const b = JSON.parse(opts.body);
    const reply = b.action === 'ping' ? { ok: true, ready: true }
      : { ok: true, sessionUrl: 'https://claude.ai/code/session_TEST', sessionId: 'session_TEST' };
    return { ok: true, text: async () => JSON.stringify(reply) };
  };
  ask.setAskConfig({ url: 'https://script.google.com/macros/s/EXAMPLE/exec', pass: 'example-pass' });
  const said = await ask.testConnection();
  must(/Connected/.test(said), 'ping answer: ' + said);
  const entry = await ask.ask('  Add a clock  ');
  must(entry.status === 'sent' && entry.sessionUrl === 'https://claude.ai/code/session_TEST', 'entry: ' + JSON.stringify(entry));
  const sent = calls.at(-1);
  must(sent.opts.headers['Content-Type'].startsWith('text/plain'), 'must be a simple text/plain request (no CORS preflight)');
  must(sent.body.action === 'ask' && sent.body.passphrase === 'example-pass', 'action/passphrase wrong');
  must(sent.body.text.endsWith('\nAdd a clock'), 'text should end with the trimmed message');
  must(store.state.asks[0].text === 'Add a clock', 'history should keep the message');
  ask.setAskConfig({});
});

await check('a relay error is kept as "not sent" with the reason', async () => {
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ ok: false, error: 'Wrong passphrase.' }) });
  ask.setAskConfig({ url: 'https://script.google.com/macros/s/EXAMPLE/exec', pass: 'nope' });
  const entry = await ask.ask('Hello');
  must(entry.status === 'failed' && entry.error === 'Wrong passphrase.', JSON.stringify(entry));
  ask.setAskConfig({});
});

// ---------- the gateway (gateway/gateway.gs), against a fake Google ----------

const { loadGateway } = await import(pathToFileURL(join(ROOT, 'tests/fake-google.mjs')).href);

await check('the gateway asks Google for exactly the narrow permissions, nothing more', () => {
  const m = JSON.parse(read('gateway/appsscript.json'));
  const want = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/script.external_request',
  ];
  must(JSON.stringify([...m.oauthScopes].sort()) === JSON.stringify([...want].sort()),
    'scopes changed: ' + m.oauthScopes.join(', ') + '. Changing them changes what the gateway may do in Ebbe\'s Google account; agree it with him first.');
  const src = read('gateway/gateway.gs');
  for (const svc of ['DriveApp', 'GmailApp', 'CalendarApp', 'MailApp', 'DocumentApp', 'SpreadsheetApp']) {
    must(!new RegExp('\\b' + svc + '\\.').test(src), svc + ' would ask Google for broader access; call the APIs through api_() instead');
  }
});

function freshGateway(opts) {
  const gw = loadGateway(join(ROOT, 'gateway/gateway.gs'), opts);
  gw.g.setup();
  return { gw, app: gw.props.get('APP_KEY'), claude: gw.props.get('CLAUDE_KEY') };
}
const item = (id, extra = {}) => ({ id, kind: 'note', title: 'Sample ' + id, updatedAt: 1000, ...extra });

await check('gateway setup makes two different keys and one data folder, and is safe to run again', () => {
  const { gw, app, claude } = freshGateway();
  must(app && claude && app !== claude && app.length === 32, 'keys');
  gw.g.setup();
  must(gw.props.get('APP_KEY') === app, 'running setup again must keep the keys');
  const folders = [...gw.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  must(folders.length === 1 && folders[0].name === 'Dashboard data', 'folders: ' + folders.map((f) => f.name));
  must(gw.calls.every((c) => c.auth === 'Bearer fake-token'), 'every Google call uses the script\'s own token');
});

await check('gateway: a wrong or missing key is refused', () => {
  const { gw } = freshGateway();
  must(/Wrong key/.test(gw.post({ action: 'pull', key: 'nope' }).error), 'wrong key');
  must(/Wrong key/.test(gw.post({ action: 'pull' }).error), 'missing key');
});

await check('gateway: the app key reaches the data only, never mail or calendars', () => {
  const { gw, app } = freshGateway();
  must(gw.post({ action: 'ping', key: app }).role === 'app', 'role');
  for (const action of ['mailSearch', 'mailGet', 'calendars', 'events', 'calendarSetup', 'eventPut', 'eventDelete']) {
    const r = gw.post({ action, key: app });
    must(!r.ok && /may not/.test(r.error), action + ' should be refused for the app key');
  }
});

await check('gateway: push then pull, with revisions; resending the same item changes nothing', () => {
  const { gw, app } = freshGateway();
  let r = gw.post({ action: 'push', key: app, since: 0, items: [item('a'), item('b')] });
  must(r.ok && r.rev === 2 && r.items.length === 2, JSON.stringify(r).slice(0, 200));
  must(gw.workspace().items.a.by === 'app' && gw.workspace().items.a.createdBy === 'app', 'by/createdBy');
  r = gw.post({ action: 'push', key: app, since: 2, items: [item('a')] });
  must(r.rev === 2 && r.items.length === 0, 'same item again should not make a new revision');
  r = gw.post({ action: 'pull', key: app, since: 1 });
  must(r.items.length === 1 && r.items[0].id === 'b', 'pull since 1 should give only b');
});

await check('gateway: the newer change wins; an older one is refused and the newer one sent back', () => {
  const { gw, app, claude } = freshGateway();
  gw.post({ action: 'push', key: app, since: 0, items: [item('a', { updatedAt: 2000, title: 'new' })] });
  const r = gw.post({ action: 'push', key: claude, since: 1, items: [item('a', { updatedAt: 1500, title: 'old' })] });
  must(r.rejected === 1 && r.items.length === 1 && r.items[0].title === 'new', JSON.stringify(r).slice(0, 200));
  must(gw.workspace().items.a.title === 'new', 'stored item must stay the newer one');
  const r2 = gw.post({ action: 'push', key: claude, since: 1, items: [item('a', { updatedAt: 2500, title: 'newest' })] });
  must(r2.accepted[0] === 'a' && gw.workspace().items.a.by === 'claude' && gw.workspace().items.a.createdBy === 'app', 'claude update');
});

await check('gateway: items without an id, kind or time are refused', () => {
  const { gw, app } = freshGateway();
  for (const bad of [{ kind: 'note', updatedAt: 1 }, { id: 'x', updatedAt: 1 }, { id: 'x', kind: 'note' }, { id: 'a b', kind: 'note', updatedAt: 1 }]) {
    must(!gw.post({ action: 'push', key: app, items: [bad] }).ok, 'should refuse ' + JSON.stringify(bad));
  }
  must(!gw.workspace(), 'nothing should be written');
});

await check('gateway: the first write of each day saves a backup', () => {
  const { gw, app } = freshGateway();
  gw.post({ action: 'push', key: app, items: [item('a')] });              // first ever: no file to back up yet
  gw.post({ action: 'push', key: app, items: [item('b')] });
  gw.setNow(Date.parse('2026-01-06T09:00:00Z'));
  gw.post({ action: 'push', key: app, items: [item('c')] });
  gw.post({ action: 'push', key: app, items: [item('d')] });
  const backups = [...gw.files.values()].filter((f) => /^workspace-\d{4}-\d\d-\d\d\.json$/.test(f.name));
  must(backups.map((f) => f.name).join() === 'workspace-2026-01-06.json', 'backups: ' + backups.map((f) => f.name));
  must(Object.keys(JSON.parse(backups[0].content).items).join() === 'a,b', 'the backup holds the day-before state');
});

await check('gateway: Claude reads mail (read only) with plain-text bodies', () => {
  const { gw, claude } = freshGateway({ mail: [{ id: 'm1', from: 'Shop <shop@example.com>', subject: 'Your order', date: 'Mon, 5 Jan 2026', text: 'Order shipped. Æ ø å.' }] });
  const s = gw.post({ action: 'mailSearch', key: claude, q: 'newer_than:1d' });
  must(s.ok && s.messages[0].subject === 'Your order' && s.messages[0].from.includes('shop@example.com'), JSON.stringify(s).slice(0, 200));
  const g = gw.post({ action: 'mailGet', key: claude, id: 'm1' });
  must(g.message.text === 'Order shipped. Æ ø å.', 'body: ' + g.message.text);
  must(gw.calls.every((c) => c.method === 'get' || !c.url.includes('gmail')), 'mail must only ever be read');
});

await check('gateway: events are only ever added, changed or deleted on the Dashboard calendar', () => {
  const { gw, claude } = freshGateway();
  const put = gw.post({ action: 'eventPut', key: claude, event: { title: 'Sample event', start: '2026-01-07T10:00:00Z' } });
  must(put.ok && put.event.id, JSON.stringify(put));
  const changed = gw.post({ action: 'eventPut', key: claude, event: { id: put.event.id, title: 'Renamed', start: '2026-01-07T11:00:00Z' } });
  must(changed.ok && changed.event.title === 'Renamed', JSON.stringify(changed));
  must(gw.post({ action: 'eventDelete', key: claude, id: put.event.id }).ok, 'delete');
  const made = [...gw.calendars.values()].filter((c) => c.summary === 'Dashboard');
  must(made.length === 1, 'one Dashboard calendar, made once');
  const writes = gw.calls.filter((c) => c.url.includes('/calendar/') && c.method !== 'get');
  must(writes.every((c) => c.url.endsWith('/calendars') || c.url.includes(encodeURIComponent(made[0].id))),
    'a calendar write went somewhere else: ' + writes.map((c) => c.method + ' ' + c.url).join(' | '));
  const cals = gw.post({ action: 'calendars', key: claude });
  must(cals.calendars.some((c) => c.primary) && cals.calendars.some((c) => c.dashboard), 'calendar list');
});

// ---------- the app's data layer (js/data.js), against the fake gateway ----------

const data = await import(pathToFileURL(join(ROOT, 'js/data.js')).href);
const GW = 'https://script.google.com/macros/s/EXAMPLE/exec';

function fetchThrough(gw) {
  return async (url, opts) => ({ ok: true, text: async () => JSON.stringify(gw.post(JSON.parse(opts.body))) });
}

await check('data: works on the device alone before Drive is connected', async () => {
  data._reset();
  await data.loadData();
  const it = data.put({ id: 'p1', kind: 'page', title: 'Sample page' });
  must(data.get('p1').title === 'Sample page' && it.updatedAt > 0, 'saved');
  must(data.pendingCount() === 1, 'should wait in the outbox');
  must(!(await data.syncNow()) && data.sync.state === 'local', 'not connected: stays local');
  data.patch('p1', { title: 'Renamed' });
  must(data.get('p1').title === 'Renamed', 'patch');
  data.remove('p1');
  must(!data.get('p1') && data.all('page').length === 0, 'removed');
});

await check('data: connecting sends what the device has, and takes what Drive has', async () => {
  data._reset();
  await data.loadData();
  const { gw, app, claude } = freshGateway();
  gw.post({ action: 'push', key: claude, items: [item('fromclaude', { kind: 'record', updatedAt: Date.now() })] });
  data.put({ id: 'local1', kind: 'page', title: 'Made offline' });
  globalThis.fetch = fetchThrough(gw);
  data.setGatewayConfig({ url: GW, key: app });
  must(/Connected/.test(await data.testGateway()), 'test');
  must(await data.syncNow(), 'sync: ' + data.sync.error);
  must(data.pendingCount() === 0, 'outbox should be empty');
  must(data.get('fromclaude') && gw.workspace().items.local1, 'both sides should have both items');
  must(data.sync.state === 'synced', data.sync.state);
});

await check('data: a newer change from Claude replaces the device copy; a newer device change wins over an older one', async () => {
  const { gw, app, claude } = freshGateway();
  data._reset();
  await data.loadData();
  globalThis.fetch = fetchThrough(gw);
  data.setGatewayConfig({ url: GW, key: app });
  data.put({ id: 'r1', kind: 'record', title: 'one' });
  await data.syncNow();
  const t = data.get('r1').updatedAt;
  gw.post({ action: 'push', key: claude, items: [{ ...gw.workspace().items.r1, title: 'tidied by Claude', updatedAt: t + 10 }] });
  await data.syncNow();
  must(data.get('r1').title === 'tidied by Claude', 'pull should bring Claude\'s change');
  gw.post({ action: 'push', key: claude, items: [{ ...gw.workspace().items.r1, title: 'stale', updatedAt: t + 5 }] });
  must(gw.workspace().items.r1.title === 'tidied by Claude', 'older change must not win');
});

await check('data: offline changes wait and go up later', async () => {
  const { gw, app } = freshGateway();
  data._reset();
  await data.loadData();
  data.setGatewayConfig({ url: GW, key: app });
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  data.put({ id: 'off1', kind: 'page', title: 'Written offline' });
  must(!(await data.syncNow()), 'should fail while offline');
  must(data.pendingCount() === 1 && ['offline', 'error'].includes(data.sync.state), 'kept in outbox: ' + data.sync.state);
  globalThis.fetch = fetchThrough(gw);
  must(await data.syncNow(), 'later sync');
  must(data.pendingCount() === 0 && gw.workspace().items.off1, 'sent');
});

await check('data: the gateway key never ends up in the data or an export', async () => {
  must(!JSON.stringify(data.all()).includes(data.gatewayConfig().key), 'key in data');
  must(!store.exportJSON().includes(data.gatewayConfig().key), 'key in export');
  data.setGatewayConfig({});
  must(!data.isDataConnected(), 'forget');
});

await check('tools/data.mjs (Claude\'s door) pushes and pulls through the gateway, and keeps data outside the repo', async () => {
  const http = await import('node:http');
  const { execFile } = await import('node:child_process');
  const { gw, claude } = freshGateway();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(gw.post(JSON.parse(body || '{}')))); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'dash-data-'));
  const env = { ...process.env, DASHBOARD_GATEWAY_URL: 'http://127.0.0.1:' + server.address().port + '/exec',
    DASHBOARD_GATEWAY_KEY: claude, DASHBOARD_DATA_DIR: dir, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' };
  const run = (args, e = env) => new Promise((resolve) => execFile(process.execPath, [join(ROOT, 'tools/data.mjs'), ...args], { env: e },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout, err: stderr })));
  try {
    const items = join(dir, 'in.json');
    writeFileSync(items, JSON.stringify([{ id: 't1', kind: 'type', name: 'Sample type' }, { id: 'r1', kind: 'record', type: 't1', title: 'Sample' }]));
    let r = await run(['push', items]);
    must(r.code === 0 && /"accepted": 2/.test(r.out), 'push: ' + r.out + r.err);
    r = await run(['pull']);
    must(r.code === 0 && /"Sample type": 1/.test(r.out), 'pull: ' + r.out + r.err);
    must(existsSync(join(dir, 'workspace.json')), 'workspace.json in the data folder');
    must(gw.workspace().items.r1.by === 'claude', 'written as claude');
    r = await run(['pull'], { ...env, DASHBOARD_DATA_DIR: join(ROOT, 'data') });
    must(r.code !== 0 && /inside the repo/.test(r.err), 'must refuse a data folder inside the repo');
  } finally {
    server.close();
  }
});

// ---------- the general model (js/model.js), with neutral sample data ----------

const model = await import(pathToFileURL(join(ROOT, 'js/model.js')).href);
const sample = await import(pathToFileURL(join(ROOT, 'js/sample.js')).href);

await check('model: views filter, sort and group records of a type; search finds pages and items', async () => {
  data._reset();
  await data.loadData();
  data.setGatewayConfig({});
  const pageId = sample.addSample();
  must(pageId && !sample.addSample(), 'the sample is added once');
  const views = data.all('view');
  const wanted = views.find((v) => v.source.filter.length);
  const rows = model.viewRecords(wanted);
  must(rows.length === 2 && rows.every((r) => r.values.status === 'wanted'), 'filter: ' + rows.map((r) => r.title));
  must(rows[0].values.price.amount <= rows[1].values.price.amount, 'sorted by price');
  must(model.search('item c')[0].item.title === 'Item C', 'search for an item');
  must(model.search('try typing').some((h) => h.item.id === pageId), 'search in page text');
  const b = data.all('record').find((r) => r.title === 'Item B');
  must(model.backlinks(b.id).some((x) => x.item.title === 'Item C'), 'Item C links to Item B');
  const t = data.get(b.type);
  must(model.formatPlain(t.fields.find((f) => f.key === 'status'), 'low') === 'Running low', 'option labels');
  must(/4[.,]50/.test(model.formatPlain(t.fields.find((f) => f.key === 'price'), { amount: 4.5, currency: 'EUR' })), 'money');
  must(model.matches(b, { field: 'qty', op: 'gt', value: 1 }) && !model.matches(b, { field: 'qty', op: 'lt', value: 1 }), 'numbers');
});

await check('model: pages form a tree; a page whose parent is gone is still shown at the top', async () => {
  const top = model.newPage({ title: 'Top' });
  const kid = model.newPage({ title: 'Kid', parent: top.id });
  const grand = model.newPage({ title: 'Grandkid', parent: kid.id });
  must(model.childPages(top.id).map((p) => p.id).join() === kid.id, 'children');
  must(model.ancestors(grand).map((p) => p.title).join('/') === 'Top/Kid', 'ancestors');
  must(model.descendants(top.id).length === 2, 'descendants');
  data.remove(kid.id);
  must(model.topPages().some((p) => p.id === grand.id), 'orphan shows at the top');
});

await check('model: "Remove sample" removes exactly the sample, nothing else', async () => {
  const keep = model.newPage({ title: 'Mine' });
  const n = sample.removeSample();
  must(n > 0 && !data.all().some((it) => it.sample), 'sample gone');
  must(data.get(keep.id), 'other pages stay');
});

await check('Ebbe\'s data never sits in the repo (no workspace or backup files)', () => {
  const bad = allFiles().filter((f) => /(^|\/)(workspace[^/]*\.json|backups?\/|dashboard-data\/)/i.test(f));
  must(!bad.length, 'remove these and keep data on Drive only: ' + bad.join(', '));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
