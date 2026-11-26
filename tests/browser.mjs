#!/usr/bin/env node
// Drives the real app in a headless browser. Needs Playwright; skips if it is
// not installed.
//
//   node tests/browser.mjs
//
// The local server answers like GitHub Pages (Cache-Control: max-age=600 and
// ETags), so the update checks below meet the same browser caching as on the
// live site. The Ask Claude relay and the Drive gateway are faked (the
// gateway is the real gateway/gateway.gs running against a fake Google);
// nothing leaves this machine. Only neutral sample data.

import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

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
  if (body.key === 'test-key') {      // the gateway, for pictures
    reply = body.action === 'filePut' ? { ok: true, file: { id: 'pic1', name: body.name, mimeType: body.mimeType, size: 10 } }
      : { ok: true, rev: 0, items: [], accepted: [] };
  } else if (relayMode === 'wrong-pass' || body.passphrase !== 'test-pass') reply = { ok: false, error: 'Wrong passphrase. Copy it again from the relay (run setup() to see it).' };
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

await check('the home screen (Today) greets and offers Ask Claude', async () => {
  await page.goto(BASE);
  await page.waitForFunction(() => /^Good /.test(document.querySelector('#todayHello').textContent));
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
  await page.click('[data-tab="today"]');
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

await check('Ask Claude takes a picture: a thumbnail, then it goes to Drive and the message names it', async () => {
  // a 3000 x 1200 screenshot stand-in, made in the page
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 3000; c.height = 1200;
    const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 3000, 1200);
    const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page.setInputFiles('#askFile', { name: 'screenshot.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForSelector('#askPics .ask-pic img');
  await page.fill('#askText', 'Look at this');
  await page.click('#askSend');
  await page.waitForFunction(() => /Google Drive/.test(document.querySelector('#askStatus').textContent));
  must(await page.$('#askPics .ask-pic img'), 'the picture stays when it cannot be sent');
  await page.evaluate(() => localStorage.setItem('dashboard.gateway', JSON.stringify({ url: 'https://script.google.com/macros/s/TESTGW/exec', key: 'test-key' })));
  await page.click('#askSend');
  await page.waitForFunction(() => /^Sent to Claude/.test(document.querySelector('#askStatus').textContent));
  const put = relayCalls.find((c) => c.action === 'filePut');
  must(put && put.mimeType === 'image/jpeg' && put.name === 'screenshot.jpg', 'a big screenshot is scaled down: ' + (put && put.name));
  const sent = relayCalls.at(-1);
  must(sent.action === 'ask' && sent.text.includes('- pic1 (screenshot.jpg)') && !sent.text.includes(put.data.slice(0, 40)), 'relay text');
  must(await page.$eval('#askPics', (el) => el.hidden), 'pictures cleared after sending');
  must(/1 picture/.test(await page.textContent('#askHistory')), 'history shows the picture');
  await page.evaluate(() => localStorage.removeItem('dashboard.gateway'));
});

await check('the app opens offline after one visit', async () => {
  await page.evaluate(() => { location.hash = '#today'; });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();                       // now controlled by the service worker
  await page.waitForSelector('#askText');
  await phone.setOffline(true);
  await page.reload();
  await page.waitForSelector('#askText');
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
    await page.waitForSelector('#askText');
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

// ---------- the workspace on a computer ----------
const work = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const { loadGateway } = await import(pathToFileURL(join(ROOT, 'tests/fake-google.mjs')).href);
const gw = loadGateway(join(ROOT, 'gateway/gateway.gs'));
gw.g.setup();
const GATEWAY = 'https://script.google.com/macros/s/TESTGATEWAY/exec';
await work.route(GATEWAY, async (route) => {
  const out = gw.post(JSON.parse(route.request().postData() || '{}'));
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
});
const w = await work.newPage();
w.on('pageerror', (e) => errors.push(e.message));
const typeIn = async (text) => { for (const ch of text) await w.keyboard.type(ch); };
const blockTypes = () => w.$$eval('#pageView .block', (els) => els.map((b) => [...b.classList].find((c) => c.startsWith('b-')).slice(2)));
const blockTexts = () => w.$$eval('#pageView .block .bt', (els) => els.map((b) => b.innerText.replace(/\n$/, '')));

await check('desktop: a sidebar with Today, Search and pages; no phone bars', async () => {
  await w.goto(BASE);
  await w.waitForSelector('#sidebar', { state: 'visible' });
  must(!(await w.isVisible('#tabbar')) && !(await w.isVisible('#topbar')), 'phone bars should be hidden on a computer');
});

await check('a new page: title, then Enter to write; Markdown shortcuts make lists, to-dos and headings', async () => {
  await w.click('#sideNewPage');
  await w.waitForSelector('#screen-page:not([hidden]) .page-title');
  must(await w.evaluate(() => document.activeElement.classList.contains('page-title')), 'the title should have the cursor');
  await typeIn('Test page');
  await w.keyboard.press('Enter');
  await typeIn('First line');
  await w.keyboard.press('Enter');
  await typeIn('- one');
  await w.keyboard.press('Enter');
  await typeIn('two');
  await w.keyboard.press('Enter');
  await w.keyboard.press('Enter');          // an empty list item ends the list
  await typeIn('[] tick me');
  await w.keyboard.press('Enter');
  await w.keyboard.press('Enter');
  await typeIn('## Section');
  const types = await blockTypes();
  must(JSON.stringify(types) === JSON.stringify(['text', 'bullet', 'bullet', 'todo', 'h2']), 'blocks: ' + types);
  must(JSON.stringify(await blockTexts()) === JSON.stringify(['First line', 'one', 'two', 'tick me', 'Section']), 'texts: ' + await blockTexts());
  await w.waitForFunction(() => /Test page/.test(document.querySelector('#pageTree').textContent), null, { timeout: 3000 });
});

await check('Backspace at the start joins blocks; the "/" menu turns a block into a quote', async () => {
  await w.keyboard.press('Enter');
  await typeIn('/quo');
  await w.waitForSelector('#menu:not([hidden]) .menu-item');
  await w.keyboard.press('Enter');
  await typeIn('Quoted');
  must((await blockTypes()).at(-1) === 'quote', 'last block should be a quote: ' + await blockTypes());
  must((await blockTexts()).at(-1) === 'Quoted', 'the "/quo" text should be gone: ' + await blockTexts());
  await w.keyboard.press('Home');
  await w.keyboard.press('Backspace');      // quote -> text
  await w.keyboard.press('Backspace');      // join with the heading above
  must((await blockTexts()).at(-1) === 'SectionQuoted', 'join: ' + await blockTexts());
});

await check('pasting several lines makes several blocks', async () => {
  await w.keyboard.press('End');
  await w.keyboard.press('Enter');
  await w.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'pasted a\n- pasted b\n[x] pasted c');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const types = await blockTypes();
  must(JSON.stringify(types.slice(-3)) === JSON.stringify(['text', 'bullet', 'todo']), 'pasted types: ' + types);
  must(await w.$eval('#pageView .block:last-child input[data-todo]', (el) => el.checked), '[x] should be ticked');
});

await check('pages are kept on the device and come back after a reload', async () => {
  await w.waitForTimeout(800);              // the editor saves shortly after typing
  await w.reload();
  await w.waitForSelector('#pageView .page-title');
  must((await w.textContent('#pageView .page-title')) === 'Test page', 'title after reload');
  must((await blockTexts()).includes('tick me'), 'blocks after reload: ' + await blockTexts());
});

await check('the sample page shows a table; an item opens in a side panel and changes there show everywhere', async () => {
  await w.evaluate(() => { location.hash = '#settings'; });
  await w.click('#setSampleAdd');
  await w.waitForSelector('.view.arch-table .tbl tbody tr');
  must(await w.isVisible('.view.arch-board .col'), 'board');
  await w.click('.view.arch-table .tbl tbody tr:first-child');
  await w.waitForSelector('#panel:not([hidden]) .rec-title');
  must(await w.isVisible('#screen-page'), 'the page stays visible beside the panel on a computer');
  await w.selectOption('#panel select[data-f="status"]', 'gone');
  await w.waitForTimeout(150);
  const firstRowStatus = await w.textContent('.view.arch-table .tbl tbody tr:first-child');
  must(/Used up/.test(firstRowStatus), 'the table should show the new status: ' + firstRowStatus);
  await w.keyboard.press('Escape');
  await w.waitForSelector('#panel', { state: 'hidden' });
});

await check('a view switches between table, board, list, gallery and checklist', async () => {
  const host = '.view[data-view]:first-of-type';
  for (const arch of ['board', 'list', 'gallery', 'checklist', 'table']) {
    await w.click('#pageView .view >> nth=0 >> [data-arch="' + arch + '"]');
    await w.waitForSelector('#pageView .view.arch-' + arch);
  }
});

await check('a checklist works like reminders: type a new item in, tick it off', async () => {
  const v = '#pageView .view >> nth=0';
  await w.click(v + ' >> [data-arch="checklist"]');
  await w.waitForSelector('#pageView .view.arch-checklist [data-quick-add]');
  const before = await w.locator('#pageView .view.arch-checklist >> nth=0').locator('.clist .crow:not(.quick)').count();
  await w.fill('#pageView .view.arch-checklist [data-quick-add] >> nth=0', 'Typed in item');
  await w.press('#pageView .view.arch-checklist [data-quick-add] >> nth=0', 'Enter');
  await w.waitForFunction(() => [...document.querySelectorAll('#pageView .view.arch-checklist .crow-title')].some((b) => b.textContent === 'Typed in item'));
  must(await w.evaluate(() => document.activeElement && document.activeElement.matches('[data-quick-add]')), 'the cursor should stay in the new-item line');
  const row = w.locator('#pageView .view.arch-checklist >> nth=0').locator('.crow', { hasText: 'Typed in item' });
  await row.locator('input.circle').check();
  await w.waitForFunction(() => [...document.querySelectorAll('#pageView .view.arch-checklist .done-list .crow-title')].some((b) => b.textContent === 'Typed in item'));
  must(before >= 0, 'count');
  // priority: tap cycles 1, 2, 3; priority 1 items come first
  const list = w.locator('#pageView .view.arch-checklist >> nth=0').locator('.clist >> nth=0');
  const last = list.locator('.crow:not(.quick) >> nth=-1');
  const lastTitle = await last.locator('.crow-title').textContent();
  await last.locator('[data-prio]').click();
  await w.waitForFunction((t) => { const r = document.querySelector('#pageView .view.arch-checklist .clist .crow'); return r && r.querySelector('.crow-title').textContent === t && r.querySelector('.prio.p1'); }, lastTitle);
  await list.locator('.crow', { hasText: lastTitle }).locator('[data-prio]').click();
  await w.waitForSelector('#pageView .view.arch-checklist .prio.p2');
  await list.locator('.crow', { hasText: lastTitle }).locator('[data-prio]').click();
  await list.locator('.crow', { hasText: lastTitle }).locator('[data-prio]').click();
  await w.waitForFunction(() => !document.querySelector('#pageView .view.arch-checklist .prio.p1, #pageView .view.arch-checklist .prio.p2, #pageView .view.arch-checklist .prio.p3'));
  await w.click(v + ' >> [data-arch="table"]');
  await w.waitForSelector('#pageView .view.arch-table');
});

await check('search finds pages and items', async () => {
  await w.keyboard.press('Control+k');
  await w.waitForSelector('#screen-search:not([hidden])');
  await w.fill('#searchInput', 'item c');
  await w.waitForTimeout(100);
  must(/Item C/.test(await w.textContent('#searchResults')), 'item c: ' + (await w.textContent('#searchResults')).slice(0, 200));
  await w.fill('#searchInput', 'tick me');
  await w.waitForTimeout(100);
  must(/Test page/.test(await w.textContent('#searchResults')), 'tick me: ' + (await w.textContent('#searchResults')).slice(0, 200) + ' hash ' + await w.evaluate(() => location.hash));
});

await check('connecting Google Drive sends everything there, and Claude\'s changes come back', async () => {
  await w.evaluate(() => { location.hash = '#settings'; });
  await w.fill('#setGwUrl', GATEWAY);
  await w.fill('#setGwKey', gw.props.get('CLAUDE_KEY'));
  await w.click('#setGwSave');
  await w.waitForFunction(() => /Claude key/.test(document.querySelector('#setGwResult').textContent));
  await w.fill('#setGwUrl', GATEWAY);
  await w.fill('#setGwKey', gw.props.get('APP_KEY'));
  await w.click('#setGwSave');
  await w.waitForFunction(() => /^Connected/.test(document.querySelector('#setGwResult').textContent));
  await w.waitForFunction(() => /Last synced/.test(document.querySelector('#setDataState').textContent), null, { timeout: 8000 });
  const ws = gw.workspace();
  const pages = Object.values(ws.items).filter((it) => it.kind === 'page' && !it.deleted).map((p) => p.title);
  must(pages.includes('Test page') && pages.includes('Sample collection'), 'pages on Drive: ' + pages);
  // Claude renames an item; the app shows it after the next sync
  const rec = Object.values(ws.items).find((it) => it.kind === 'record' && it.title === 'Item B');
  gw.post({ action: 'push', key: gw.props.get('CLAUDE_KEY'), items: [{ ...rec, title: 'Item B (tidied)', updatedAt: Date.now() + 1000 }] });
  await w.click('#setGwSync');
  await w.evaluate(() => { location.hash = '#search'; });
  await w.fill('#searchInput', 'tidied');
  await w.waitForFunction(() => /Item B \(tidied\)/.test(document.querySelector('#searchResults').textContent), null, { timeout: 8000 });
  must(/Saved to Drive/.test(await w.textContent('#sideSync')), 'sync status: ' + await w.textContent('#sideSync'));
});

await check('a visitor without a key sees an empty app', async () => {
  const stranger = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const s = await stranger.newPage();
  await s.goto(BASE);
  await s.waitForSelector('#recentPages');
  must(/No pages yet/.test(await s.textContent('#recentPages')), 'should have no pages');
  must(!/Test page|Item B/.test(await s.content()), 'must show none of the data');
  await stranger.close();
});

// ---------- the workspace on a phone ----------
const ph = await browser.newContext({ ...devices['iPhone 13'] });
const p2 = await ph.newPage();
p2.on('pageerror', (e) => errors.push(e.message));

await check('phone: tab bar, Pages tab, an item opens full screen and closes again', async () => {
  await p2.goto(BASE + '#settings');
  await p2.click('#setSampleAdd');
  await p2.waitForSelector('#pageView .tbl tbody tr');
  must(!(await p2.isVisible('#sidebar')) && await p2.isVisible('#tabbar'), 'phone layout');
  await p2.click('[data-tab="pages"]');
  await p2.waitForSelector('#screen-pages:not([hidden]) .t-link');
  await p2.click('#pagesList .t-link');
  await p2.waitForSelector('#screen-page:not([hidden]) .tbl tbody tr');
  await p2.click('#pageView .tbl tbody tr >> nth=0');
  await p2.waitForSelector('#panel:not([hidden])');
  const box = await p2.$eval('#panel', (el) => { const r = el.getBoundingClientRect(); return [r.left, r.width, innerWidth]; });
  must(box[0] === 0 && box[1] === box[2], 'the item should fill the screen: ' + box);
  await p2.click('#panel [data-close]');
  await p2.waitForSelector('#panel', { state: 'hidden' });
  await p2.click('#backBtn');
  await p2.waitForSelector('#screen-pages:not([hidden])');
});

await check('phone: the Ask tab goes to the Ask Claude box', async () => {
  await p2.click('[data-tab="ask"]');
  await p2.waitForFunction(() => document.activeElement && document.activeElement.id === 'askText');
});

await check('no script errors on any page', () => {
  must(!errors.length, errors.join(' | '));
});

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
