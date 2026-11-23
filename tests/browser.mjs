#!/usr/bin/env node
// Drives the real app in a headless browser. Needs Playwright; skips if it is
// not installed.
//
//   node tests/browser.mjs
//
// The local server answers like GitHub Pages (Cache-Control: max-age=600 and
// ETags), so the update checks below meet the same browser caching as on the
// live site. The Ask Claude relay is faked inside the browser; nothing leaves
// this machine.

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

let chromium, devices;
try {
  ({ chromium, devices } = await import('playwright'));
} catch (e) {
  console.log('skipped: Playwright is not installed here (node tests/run.mjs still covers the logic)');
  process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

let servedBuild = null;   // set to pretend a newer version is online
const server = http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = readFileSync(file);
  if (servedBuild !== null && path === '/js/version.js') {
    body = Buffer.from(body.toString().replace(/BUILD = \d+/, 'BUILD = ' + servedBuild));
  }
  const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://localhost:' + server.address().port + '/';
const BUILD = Number(/BUILD = (\d+)/.exec(readFileSync(join(ROOT, 'js/version.js'), 'utf8'))[1]);

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.message || e).split('\n')[0]); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

// A fake relay: answers like ask-claude/relay.gs.
const RELAY = 'https://script.google.com/macros/s/TESTRELAY/exec';
let relayMode = 'ok';
const relayCalls = [];
async function fakeRelay(route) {
  const body = JSON.parse(route.request().postData() || '{}');
  relayCalls.push(body);
  let reply;
  if (relayMode === 'wrong-pass' || body.passphrase !== 'test-pass') reply = { ok: false, error: 'Wrong passphrase. Copy it again from the relay (run setup() to see it).' };
  else if (body.action === 'ping') reply = { ok: true, ready: true };
  else reply = { ok: true, sessionUrl: 'https://claude.ai/code/session_TEST', sessionId: 'session_TEST' };
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(reply) });
}

const browser = await chromium.launch();
const errors = [];

// ---------- on a phone ----------
const phone = await browser.newContext({ ...devices['iPhone 13'] });
await phone.route('https://script.google.com/**', fakeRelay);
const page = await phone.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await check('the home screen says hello and offers Ask Claude', async () => {
  await page.goto(BASE);
  await page.waitForSelector('text=Hello, world.');
  const mode = await page.textContent('#askMode');
  must(/Opens the Claude app/.test(mode), 'not-connected hint: ' + mode);
});

await check('Settings shows the version and that it is the newest', async () => {
  await page.click('#settingsBtn');
  await page.waitForSelector('#screen-settings:not([hidden])');
  must((await page.textContent('#setBuild')) === 'v' + BUILD, 'version');
  await page.waitForFunction(() => !/Checking/.test(document.querySelector('#setOnline').textContent));
  must(/newest version/.test(await page.textContent('#setOnline')), await page.textContent('#setOnline'));
});

await check('Save and test: a wrong passphrase is reported plainly', async () => {
  await page.fill('#setRelayUrl', RELAY);
  await page.fill('#setRelayPass', 'wrong');
  await page.click('#setAskSave');
  await page.waitForFunction(() => /passphrase/i.test(document.querySelector('#setAskResult').textContent));
  must(await page.$eval('#setAskResult', (el) => el.classList.contains('bad')), 'should be shown as a problem');
});

await check('Save and test: the right passphrase connects', async () => {
  await page.fill('#setRelayPass', 'test-pass');
  await page.click('#setAskSave');
  await page.waitForFunction(() => /^Connected/.test(document.querySelector('#setAskResult').textContent));
  must(/Connected on this device/.test(await page.textContent('#setAskState')), 'state line');
});

await check('Ask Claude sends the message and links to the Claude session', async () => {
  await page.click('#brand');
  await page.waitForSelector('#screen-home:not([hidden])');
  must(/straight to Claude/.test(await page.textContent('#askMode')), 'connected hint');
  await page.fill('#askText', 'Add a clock');
  await page.click('#askSend');
  await page.waitForFunction(() => /^Sent to Claude/.test(document.querySelector('#askStatus').textContent));
  const link = await page.getAttribute('#askStatus a', 'href');
  must(link === 'https://claude.ai/code/session_TEST', 'session link: ' + link);
  const sent = relayCalls.at(-1);
  must(sent.action === 'ask' && sent.text.endsWith('\nAdd a clock') && /iPhone/.test(sent.text), 'relay got: ' + JSON.stringify(sent).slice(0, 160));
  must((await page.inputValue('#askText')) === '', 'box should be cleared');
  must(/Add a clock/.test(await page.textContent('#askHistory')), 'history');
});

await check('a refused message stays recoverable', async () => {
  relayMode = 'wrong-pass';
  await page.fill('#askText', 'Make the clock bigger');
  await page.click('#askSend');
  await page.waitForFunction(() => /^Not sent/.test(document.querySelector('#askStatus').textContent));
  await page.fill('#askText', '');
  await page.click('[data-refill]');
  must((await page.inputValue('#askText')) === 'Make the clock bigger', 'Put back in the box');
  relayMode = 'ok';
});

await check('the app opens offline after one visit', async () => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();                       // now controlled by the service worker
  await page.waitForSelector('text=Hello, world.');
  await phone.setOffline(true);
  await page.reload();
  await page.waitForSelector('text=Hello, world.');
  await phone.setOffline(false);
});

// The page stays open (as an installed app does) while Claude publishes a
// new version; coming back to the app should notice it.
await check('a newer version online shows the note, and Update now loads it', async () => {
  try {
    await page.evaluate(() => { location.hash = ''; });
    await page.waitForSelector('#screen-home:not([hidden])');
    servedBuild = BUILD + 1;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('#updateNote:not([hidden])', { timeout: 10000 });
    must(new RegExp('v' + (BUILD + 1)).test(await page.textContent('#updateText')), await page.textContent('#updateText'));
    await Promise.all([page.waitForEvent('load'), page.click('#updateNow')]);
    await page.waitForSelector('text=Hello, world.');
    await page.evaluate(() => { location.hash = '#settings'; });
    await page.waitForSelector('#screen-settings:not([hidden])');
    const shown = await page.textContent('#setBuild');
    must(shown === 'v' + (BUILD + 1), 'after updating, Settings should show v' + (BUILD + 1) + ', got ' + shown);
  } finally {
    servedBuild = null;
  }
});

// Same again from Settings, with the files the browser holds now marked
// fresh for 10 minutes (max-age=600): Force update must still get the new ones.
await check('Force update in Settings replaces files the browser thinks are fresh', async () => {
  await page.evaluate(() => { location.hash = '#settings'; });
  await page.waitForSelector('#screen-settings:not([hidden])');
  await Promise.all([page.waitForEvent('load'), page.click('#setForce')]);
  // the reload keeps the #settings address, so Settings is what comes back
  await page.waitForSelector('#screen-settings:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#setBuild').textContent !== '');
  const shown = await page.textContent('#setBuild');
  must(shown === 'v' + BUILD, 'expected v' + BUILD + ' again, got ' + shown);
});

// ---------- on a computer, not connected ----------
const desk = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await desk.route('https://claude.ai/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>claude.ai stand-in</p>' }));
const dpage = await desk.newPage();
dpage.on('pageerror', (e) => errors.push(e.message));

await check('not connected: Ask Claude opens Claude Code with the message and repo filled in', async () => {
  await dpage.goto(BASE);
  await dpage.fill('#askText', 'What can you add here?');
  const [tab] = await Promise.all([desk.waitForEvent('page'), dpage.click('#askSend')]);
  const url = new URL(tab.url());
  must(url.origin === 'https://claude.ai' && url.pathname === '/code/new', 'opened ' + tab.url().slice(0, 60));
  must(url.searchParams.get('repo') && url.searchParams.get('q').endsWith('What can you add here?'), 'params');
  must(/Opened in Claude/.test(await dpage.textContent('#askStatus')), 'status');
});

await check('no script errors on any page', () => {
  must(!errors.length, errors.join(' | '));
});

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
