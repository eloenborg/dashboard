// A stand-in for Google, for testing gateway/gateway.gs in plain Node.
//
// It loads the gateway script into a sandbox with fake Apps Script services
// (PropertiesService, UrlFetchApp, ...) and fake Drive, Gmail and Calendar
// APIs that keep everything in memory. Every API call is recorded, so tests
// can check what the gateway asked Google for. Only neutral sample data here.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

export function loadGateway(path, opts = {}) {
  const props = new Map();
  const cache = new Map();
  const logs = [];
  const calls = [];
  let clock = opts.now || Date.parse('2026-01-05T09:00:00Z');

  // ---- fake Google data ----
  const files = new Map();      // id -> { id, name, mimeType, parents, content, trashed, createdTime }
  let fileSeq = 0;
  const newFileId = () => 'file' + (++fileSeq);
  const mail = opts.mail || [];
  const calendars = new Map([['primary', { id: 'primary', summary: 'Main', primary: true, events: new Map() }]]);
  let eventSeq = 0;

  function reply(code, body) {
    const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    return { getResponseCode: () => code, getContentText: () => text };
  }

  function route(req) {
    const method = (req.method || 'get').toLowerCase();
    const u = new URL(req.url);
    const path = u.pathname;
    const body = req.payload;
    calls.push({ method, url: req.url, auth: req.headers && req.headers.Authorization });
    let m;

    // ---------- Drive ----------
    if (u.host === 'www.googleapis.com' && path.startsWith('/upload/drive/v3/files')) {
      if (method === 'post' && u.searchParams.get('uploadType') === 'multipart') {
        const parts = body.split(/--dashboard\d+(?:--)?/).map((p) => p.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '')).filter(Boolean);
        const meta = JSON.parse(parts[0]);
        const id = newFileId();
        files.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], content: parts[1], trashed: false, createdTime: new Date(clock).toISOString() });
        return reply(200, { id });
      }
      if (method === 'patch' && (m = /\/files\/([\w-]+)$/.exec(path))) {
        const f = files.get(m[1]);
        if (!f) return reply(404, { error: { message: 'File not found' } });
        f.content = body;
        return reply(200, { id: f.id });
      }
    }
    if (u.host === 'www.googleapis.com' && path.startsWith('/drive/v3/files')) {
      if (path === '/drive/v3/files' && method === 'post') {
        const meta = JSON.parse(body);
        const id = newFileId();
        files.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], content: '', trashed: false, createdTime: new Date(clock).toISOString() });
        return reply(200, { id });
      }
      if (path === '/drive/v3/files' && method === 'get') {
        const q = u.searchParams.get('q') || '';
        const parent = (/'([\w-]+)' in parents/.exec(q) || [])[1];
        const name = (/name = '([^']+)'/.exec(q) || [])[1];
        const before = (/createdTime < '([^']+)'/.exec(q) || [])[1];
        const found = [...files.values()].filter((f) => !f.trashed && (!parent || f.parents.includes(parent)) &&
          (!name || f.name === name) && (!before || f.createdTime < before));
        return reply(200, { files: found.map((f) => ({ id: f.id })) });
      }
      if ((m = /^\/drive\/v3\/files\/([\w-]+)\/copy$/.exec(path)) && method === 'post') {
        const src = files.get(m[1]);
        const meta = JSON.parse(body);
        const id = newFileId();
        files.set(id, { ...src, id, name: meta.name, parents: meta.parents, createdTime: new Date(clock).toISOString() });
        return reply(200, { id });
      }
      if ((m = /^\/drive\/v3\/files\/([\w-]+)$/.exec(path))) {
        const f = files.get(m[1]);
        if (method === 'delete') { files.delete(m[1]); return reply(204); }
        if (!f) return reply(404, { error: { message: 'File not found' } });
        if (u.searchParams.get('alt') === 'media') return reply(200, f.content);
        return reply(200, { id: f.id, trashed: f.trashed });
      }
    }

    // ---------- Gmail ----------
    if (u.host === 'gmail.googleapis.com') {
      if (path === '/gmail/v1/users/me/messages') {
        const max = Number(u.searchParams.get('maxResults')) || 100;
        return reply(200, { messages: mail.slice(0, max).map((x) => ({ id: x.id, threadId: x.id })) });
      }
      if ((m = /^\/gmail\/v1\/users\/me\/messages\/(\w+)$/.exec(path))) {
        const x = mail.find((y) => y.id === m[1]);
        if (!x) return reply(404, { error: { message: 'Not found' } });
        const headers = [{ name: 'From', value: x.from }, { name: 'Subject', value: x.subject }, { name: 'Date', value: x.date }];
        const payload = { mimeType: 'multipart/alternative', headers, parts: [
          { mimeType: 'text/plain', body: { data: Buffer.from(x.text).toString('base64url') } },
        ] };
        return reply(200, { id: x.id, threadId: x.id, snippet: x.text.slice(0, 50), labelIds: ['INBOX'], payload });
      }
    }

    // ---------- Calendar ----------
    if (u.host === 'www.googleapis.com' && path.startsWith('/calendar/v3')) {
      if (path === '/calendar/v3/users/me/calendarList') {
        return reply(200, { items: [...calendars.values()].map((c) => ({ id: c.id, summary: c.summary, primary: !!c.primary })) });
      }
      if (path === '/calendar/v3/calendars' && method === 'post') {
        const meta = JSON.parse(body);
        const id = 'cal' + calendars.size + '@group.calendar.google.com';
        calendars.set(id, { id, summary: meta.summary, events: new Map() });
        return reply(200, { id, summary: meta.summary });
      }
      if ((m = /^\/calendar\/v3\/calendars\/([^/]+)$/.exec(path)) && method === 'get') {
        const c = calendars.get(decodeURIComponent(m[1]));
        return c ? reply(200, { id: c.id }) : reply(404, { error: { message: 'Not Found' } });
      }
      if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path))) {
        const c = calendars.get(decodeURIComponent(m[1]));
        if (!c) return reply(404, { error: { message: 'Not Found' } });
        const evId = m[2] && decodeURIComponent(m[2]);
        if (method === 'get') return reply(200, { items: [...c.events.values()] });
        if (method === 'post') {
          const ev = { ...JSON.parse(body), id: 'ev' + (++eventSeq), status: 'confirmed' };
          c.events.set(ev.id, ev);
          return reply(200, ev);
        }
        if (method === 'patch') {
          const ev = c.events.get(evId);
          if (!ev) return reply(404, { error: { message: 'Not Found' } });
          Object.assign(ev, JSON.parse(body));
          return reply(200, ev);
        }
        if (method === 'delete') { c.events.delete(evId); return reply(204); }
      }
    }
    return reply(404, { error: { message: 'fake Google has no ' + method + ' ' + path } });
  }

  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
      deleteProperty: (k) => { props.delete(k); },
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (cache.has(k) ? cache.get(k) : null),
      put: (k, v) => { cache.set(k, v); },
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp: { getOAuthToken: () => 'fake-token' },
    UrlFetchApp: { fetchAll: (reqs) => reqs.map(route) },
    Utilities: {
      sleep() {},
      getUuid: () => randomUUID(),
      formatDate: (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
      base64DecodeWebSafe: (s) => [...Buffer.from(s, 'base64url')],
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    Logger: { log: (s) => logs.push(String(s)) },
    Date: class extends Date {
      constructor(...a) { super(...(a.length ? a : [clock])); }
      static now() { return clock; }
    },
    JSON, Math, Number, String, Object, Array, Error, RegExp, encodeURIComponent, decodeURIComponent, parseInt,
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path, 'utf8'), sandbox, { filename: path });

  return {
    g: sandbox,
    props, logs, calls, files, calendars,
    setNow(t) { clock = t; },
    // What the dashboard or Claude would get back from the web app.
    post(body) {
      const out = sandbox.doPost({ postData: { contents: JSON.stringify(body) } });
      return JSON.parse(out.text);
    },
    workspace() {
      const f = [...files.values()].find((x) => x.name === 'workspace.json' && !x.parents.some((p) => files.get(p)?.name === 'backups'));
      return f ? JSON.parse(f.content) : null;
    },
  };
}
