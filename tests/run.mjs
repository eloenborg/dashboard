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

await check('sw.js and ask-claude/relay.gs parse as scripts', () => {
  for (const f of ['sw.js', 'ask-claude/relay.gs']) {
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
