/**
 * Dashboard gateway. Google Apps Script, in Ebbe's own Google account.
 *
 * The only door between the dashboard (and Claude's background runs) and
 * Ebbe's Google account. What it may touch is fixed by the scopes in
 * appsscript.json, and Google enforces them, not this code:
 *
 *   drive.file             only files and folders this script created: the
 *                          "Dashboard data" folder and what is inside it.
 *                          Nothing else in Drive is visible to it.
 *   gmail.readonly         read mail. It cannot send, delete, label or move.
 *   calendar.readonly      see every calendar and event.
 *   calendar.app.created   make the "Dashboard" calendar, and add, change or
 *                          delete events on calendars this script created only.
 *   script.external_request  lets the script call those Google APIs.
 *
 * Two keys, made by setup():
 *   APP_KEY     typed into the app on each device. Reads and writes the data
 *               folder only.
 *   CLAUDE_KEY  kept in the Claude task's environment settings only. Can also
 *               read mail and calendars, and manage the Dashboard calendar.
 *
 * The data: one file, workspace.json, in the data folder. It holds items
 * (pages, record types, records, views, briefs), each with an id, a kind and
 * an updatedAt time. Writers send whole items; the newer updatedAt wins, so
 * the phone, the computer and Claude can all write without overwriting each
 * other's newer work. Every write gets a revision number, so readers can ask
 * for "everything since revision N". The day's first write also saves a copy
 * in the backups folder (kept 30 days).
 *
 * Setup: README.md, "Set up the data on Google Drive".
 * Nothing in this file is secret. The keys live in Script Properties.
 */

var FORMAT = 'dashboard-workspace';
var DATA_FOLDER_NAME = 'Dashboard data';
var CALENDAR_NAME = 'Dashboard';
var TIME_ZONE = 'Europe/Copenhagen';
var KEEP_BACKUP_DAYS = 30;
var MAX_ITEM_BYTES = 1000000;
var MAX_PER_HOUR = 1200;

var DRIVE = 'https://www.googleapis.com/drive/v3';
var DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';
var GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
var CAL = 'https://www.googleapis.com/calendar/v3';

// Which actions each key may use.
var ALLOWED = {
  app: ['ping', 'pull', 'push'],
  claude: ['ping', 'pull', 'push', 'mailSearch', 'mailGet', 'calendars', 'events',
           'calendarSetup', 'eventPut', 'eventDelete']
};

// ---------------------------------------------------------------- web app

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var role = roleFor_(String(body.key || ''));
    if (!role) {
      Utilities.sleep(1500);   // slows down guessing
      throw new Error('Wrong key. Copy it again from the gateway (run setup() to see it).');
    }
    var action = String(body.action || '');
    if (ALLOWED[role].indexOf(action) < 0) throw new Error('This key may not do "' + action + '".');
    countThisHour_();
    out = ACTIONS[action](body, role);
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Opening the address in a browser shows this. It reveals nothing.
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, gateway: 'dashboard' }))
    .setMimeType(ContentService.MimeType.JSON);
}

var ACTIONS = {
  ping: function (body, role) {
    var p = props_();
    return { role: role, folder: !!p.getProperty('FOLDER_ID'), calendar: !!p.getProperty('CALENDAR_ID') };
  },

  // { since } -> { rev, items: items written after revision `since` }
  pull: function (body) {
    var ws = readWorkspace_();
    return { rev: ws.rev, items: changedSince_(ws, Number(body.since) || 0) };
  },

  // { since, items: [whole items] } -> { rev, items: everything after `since`,
  //   including the accepted items with their new revisions, and the current
  //   version of any item that was older than what is stored }
  push: function (body, role) {
    var incoming = body.items;
    if (!Array.isArray(incoming)) throw new Error('push needs a list of items.');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var ws = readWorkspace_();
      var before = ws.rev;
      var r = mergeItems_(ws, incoming, role, Date.now());
      if (ws.rev !== before) {
        backupOncePerDay_();
        writeWorkspace_(ws);
      }
      var since = Number(body.since) || 0;
      var items = changedSince_(ws, since);
      r.rejected.forEach(function (it) { if (!(it.rev > since)) items.push(it); });
      return { rev: ws.rev, items: items, accepted: r.accepted, rejected: r.rejected.length };
    } finally {
      lock.releaseLock();
    }
  },

  // { q, max } -> { messages: [{ id, threadId, from, to, subject, date, snippet, labels }] }
  // q is Gmail's own search syntax, e.g. "newer_than:1d -category:promotions".
  mailSearch: function (body) {
    var max = Math.min(Math.max(Number(body.max) || 20, 1), 50);
    var list = api_('get', GMAIL + '/messages?maxResults=' + max + '&q=' + encodeURIComponent(String(body.q || '')));
    var ids = (list.messages || []).map(function (m) { return m.id; });
    var reqs = ids.map(function (id) {
      return request_('get', GMAIL + '/messages/' + id +
        '?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date');
    });
    var messages = UrlFetchApp.fetchAll(reqs).map(function (res) {
      var m = parse_(res);
      var h = headers_(m.payload);
      return { id: m.id, threadId: m.threadId, from: h.from || '', to: h.to || '', subject: h.subject || '',
               date: h.date || '', snippet: m.snippet || '', labels: m.labelIds || [] };
    });
    return { messages: messages };
  },

  // { id } -> { message: { ..., text } } with the plain-text body (cut at 30,000 characters)
  mailGet: function (body) {
    var id = String(body.id || '');
    if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('mailGet needs a message id.');
    var m = api_('get', GMAIL + '/messages/' + id + '?format=full');
    var h = headers_(m.payload);
    var text = bodyText_(m.payload);
    return { message: { id: m.id, threadId: m.threadId, from: h.from || '', to: h.to || '',
      subject: h.subject || '', date: h.date || '', labels: m.labelIds || [], text: text.slice(0, 30000) } };
  },

  // -> { calendars: [{ id, name, primary, dashboard }] }
  calendars: function () {
    var dash = props_().getProperty('CALENDAR_ID') || '';
    var list = api_('get', CAL + '/users/me/calendarList?maxResults=250');
    return { calendars: (list.items || []).map(function (c) {
      return { id: c.id, name: c.summaryOverride || c.summary || '', primary: !!c.primary,
               dashboard: c.id === dash, timeZone: c.timeZone || '' };
    }) };
  },

  // { calendarId (default: primary), from, to (ISO times), max } -> { events }
  events: function (body) {
    var cal = String(body.calendarId || 'primary');
    var from = new Date(body.from || Date.now());
    var to = new Date(body.to || (from.getTime() + 7 * 864e5));
    var max = Math.min(Math.max(Number(body.max) || 100, 1), 250);
    var url = CAL + '/calendars/' + encodeURIComponent(cal) + '/events?singleEvents=true&orderBy=startTime' +
      '&maxResults=' + max + '&timeMin=' + encodeURIComponent(from.toISOString()) +
      '&timeMax=' + encodeURIComponent(to.toISOString());
    var res = api_('get', url);
    return { events: (res.items || []).map(eventOut_) };
  },

  // Makes the Dashboard calendar once. -> { calendarId }
  calendarSetup: function () {
    return { calendarId: dashboardCalendar_() };
  },

  // { event: { id?, title, start, end, allDay, description, location } } -> { event }
  // Only ever on the Dashboard calendar.
  eventPut: function (body) {
    var cal = dashboardCalendar_();
    var ev = body.event || {};
    if (!ev.title || !ev.start) throw new Error('An event needs a title and a start.');
    var g = { summary: String(ev.title), description: String(ev.description || ''), location: String(ev.location || '') };
    if (ev.allDay) {
      var endDay = ev.end || nextDay_(ev.start);
      g.start = { date: String(ev.start).slice(0, 10) };
      g.end = { date: String(endDay).slice(0, 10) };
    } else {
      var end = ev.end || new Date(new Date(ev.start).getTime() + 3600e3).toISOString();
      g.start = { dateTime: new Date(ev.start).toISOString(), timeZone: TIME_ZONE };
      g.end = { dateTime: new Date(end).toISOString(), timeZone: TIME_ZONE };
    }
    var base = CAL + '/calendars/' + encodeURIComponent(cal) + '/events';
    var saved = ev.id ? api_('patch', base + '/' + encodeURIComponent(ev.id), g) : api_('post', base, g);
    return { event: eventOut_(saved) };
  },

  // { id } -> {} . Only ever on the Dashboard calendar.
  eventDelete: function (body) {
    var cal = dashboardCalendar_();
    if (!body.id) throw new Error('eventDelete needs an event id.');
    api_('delete', CAL + '/calendars/' + encodeURIComponent(cal) + '/events/' + encodeURIComponent(String(body.id)));
    return {};
  }
};

// ------------------------------------------------------------------ setup

// Run once from the editor. Makes the keys and the data folder, and prints
// the keys. Safe to run again: it keeps what already exists.
function setup() {
  var p = props_();
  if (!p.getProperty('APP_KEY')) p.setProperty('APP_KEY', newKey_());
  if (!p.getProperty('CLAUDE_KEY')) p.setProperty('CLAUDE_KEY', newKey_());
  var folder = dataFolder_();
  Logger.log('Data folder: "' + DATA_FOLDER_NAME + '" in your Drive (id ' + folder + ').');
  Logger.log('APP KEY (paste into the dashboard, Settings, on each device): ' + p.getProperty('APP_KEY'));
  Logger.log('CLAUDE KEY (paste into the Claude task settings only, never into the app): ' + p.getProperty('CLAUDE_KEY'));
}

// Makes new keys. The old ones stop working at once.
function newKeysAndForgetOld() {
  var p = props_();
  p.deleteProperty('APP_KEY');
  p.deleteProperty('CLAUDE_KEY');
  setup();
}

// Optional check from the editor: reads the data file and says what is in it.
function testData() {
  var ws = readWorkspace_();
  var counts = {};
  Object.keys(ws.items).forEach(function (id) {
    var it = ws.items[id];
    if (!it.deleted) counts[it.kind] = (counts[it.kind] || 0) + 1;
  });
  Logger.log('Revision ' + ws.rev + '. Items: ' + JSON.stringify(counts));
}

// ------------------------------------------------------------- the data

function emptyWorkspace_() {
  return { format: FORMAT, v: 1, rev: 0, items: {} };
}

// Merges whole items into the workspace. The newer updatedAt wins; an equal
// time counts as the same write again (safe to resend). Returns the ids taken
// and the stored items that were newer than what was sent.
function mergeItems_(ws, incoming, role, now) {
  var accepted = [], rejected = [];
  incoming.forEach(function (it) {
    checkItem_(it);
    var cur = ws.items[it.id];
    if (cur && (Number(cur.updatedAt) || 0) > (Number(it.updatedAt) || 0)) { rejected.push(cur); return; }
    var copy = JSON.parse(JSON.stringify(it));
    delete copy.rev;
    if (cur && sameItem_(cur, copy)) { accepted.push(it.id); return; }
    copy.createdAt = cur ? cur.createdAt : (Number(copy.createdAt) || now);
    copy.createdBy = cur ? (cur.createdBy || role) : role;
    copy.by = role;
    ws.rev += 1;
    copy.rev = ws.rev;
    ws.items[it.id] = copy;
    accepted.push(it.id);
  });
  return { accepted: accepted, rejected: rejected };
}

function sameItem_(cur, next) {
  var a = JSON.parse(JSON.stringify(cur));
  delete a.rev; delete a.by; delete a.createdBy; delete a.createdAt;
  var b = JSON.parse(JSON.stringify(next));
  delete b.by; delete b.createdBy; delete b.createdAt;
  return stable_(a) === stable_(b);
}

function stable_(v) {
  if (Array.isArray(v)) return '[' + v.map(stable_).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stable_(v[k]); }).join(',') + '}';
  }
  return JSON.stringify(v);
}

function checkItem_(it) {
  if (!it || typeof it !== 'object' || Array.isArray(it)) throw new Error('Each item must be an object.');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(it.id || ''))) throw new Error('An item has a missing or odd id.');
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(String(it.kind || ''))) throw new Error('Item ' + it.id + ' has a missing or odd kind.');
  if (!(Number(it.updatedAt) > 0)) throw new Error('Item ' + it.id + ' has no updatedAt time.');
  if (JSON.stringify(it).length > MAX_ITEM_BYTES) throw new Error('Item ' + it.id + ' is too big.');
}

function changedSince_(ws, since) {
  var out = [];
  Object.keys(ws.items).forEach(function (id) {
    if (ws.items[id].rev > since) out.push(ws.items[id]);
  });
  out.sort(function (a, b) { return a.rev - b.rev; });
  return out;
}

function readWorkspace_() {
  var id = workspaceFile_();
  if (!id) return emptyWorkspace_();
  var text = fetchText_(DRIVE + '/files/' + id + '?alt=media');
  var ws;
  try { ws = JSON.parse(text); } catch (e) { throw new Error('workspace.json in the data folder could not be read.'); }
  if (!ws || ws.format !== FORMAT) throw new Error('workspace.json in the data folder is not a dashboard file.');
  if (!ws.items) ws.items = {};
  return ws;
}

function writeWorkspace_(ws) {
  var text = JSON.stringify(ws);
  var id = workspaceFile_();
  if (id) {
    api_('patch', DRIVE_UP + '/files/' + id + '?uploadType=media', text, 'application/json');
  } else {
    var made = createFile_('workspace.json', dataFolder_(), text);
    props_().setProperty('FILE_ID', made);
  }
}

// The workspace file's id, or '' when there is none yet.
function workspaceFile_() {
  var p = props_();
  var id = p.getProperty('FILE_ID') || '';
  if (id) return id;
  var found = findChild_(dataFolder_(), 'workspace.json');
  if (found) p.setProperty('FILE_ID', found);
  return found;
}

function dataFolder_() {
  var p = props_();
  var id = p.getProperty('FOLDER_ID');
  if (id) {
    var meta = api_('get', DRIVE + '/files/' + id + '?fields=id,trashed', null, null, true);
    if (meta && meta.id && !meta.trashed) return id;
    p.deleteProperty('FILE_ID');
    p.deleteProperty('BACKUP_FOLDER_ID');
  }
  var made = api_('post', DRIVE + '/files?fields=id', { name: DATA_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' });
  p.setProperty('FOLDER_ID', made.id);
  return made.id;
}

function backupFolder_() {
  var p = props_();
  var id = p.getProperty('BACKUP_FOLDER_ID');
  if (id) return id;
  var folder = dataFolder_();
  id = findChild_(folder, 'backups');
  if (!id) {
    id = api_('post', DRIVE + '/files?fields=id', { name: 'backups', mimeType: 'application/vnd.google-apps.folder', parents: [folder] }).id;
  }
  p.setProperty('BACKUP_FOLDER_ID', id);
  return id;
}

// The day's first write copies the current file to backups/workspace-YYYY-MM-DD.json
// and deletes backups older than KEEP_BACKUP_DAYS.
function backupOncePerDay_() {
  var day = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM-dd');
  var p = props_();
  if (p.getProperty('BACKUP_DAY') === day) return;
  var file = workspaceFile_();
  if (file) {
    var folder = backupFolder_();
    api_('post', DRIVE + '/files/' + file + '/copy?fields=id', { name: 'workspace-' + day + '.json', parents: [folder] });
    var old = new Date(Date.now() - KEEP_BACKUP_DAYS * 864e5).toISOString();
    var q = "'" + folder + "' in parents and trashed = false and createdTime < '" + old + "'";
    var list = api_('get', DRIVE + '/files?fields=files(id)&q=' + encodeURIComponent(q));
    (list.files || []).forEach(function (f) { api_('delete', DRIVE + '/files/' + f.id); });
  }
  p.setProperty('BACKUP_DAY', day);
}

function findChild_(folder, name) {
  var q = "'" + folder + "' in parents and name = '" + name + "' and trashed = false";
  var list = api_('get', DRIVE + '/files?fields=files(id)&q=' + encodeURIComponent(q));
  return (list.files && list.files[0] && list.files[0].id) || '';
}

function createFile_(name, folder, text) {
  var boundary = 'dashboard' + Date.now();
  var meta = JSON.stringify({ name: name, parents: [folder], mimeType: 'application/json' });
  var payload = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
    '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + text + '\r\n--' + boundary + '--';
  var made = api_('post', DRIVE_UP + '/files?uploadType=multipart&fields=id', payload, 'multipart/related; boundary=' + boundary);
  return made.id;
}

// ------------------------------------------------------------- calendar

function dashboardCalendar_() {
  var p = props_();
  var id = p.getProperty('CALENDAR_ID');
  if (id) {
    var found = api_('get', CAL + '/calendars/' + encodeURIComponent(id), null, null, true);
    if (found && found.id) return id;
  }
  var made = api_('post', CAL + '/calendars', { summary: CALENDAR_NAME, timeZone: TIME_ZONE,
    description: 'Events added by the dashboard. Delete this calendar to remove them all.' });
  p.setProperty('CALENDAR_ID', made.id);
  return made.id;
}

function eventOut_(e) {
  return {
    id: e.id, title: e.summary || '', description: e.description || '', location: e.location || '',
    start: (e.start && (e.start.dateTime || e.start.date)) || '',
    end: (e.end && (e.end.dateTime || e.end.date)) || '',
    allDay: !!(e.start && e.start.date && !e.start.dateTime),
    status: e.status || '', link: e.htmlLink || ''
  };
}

function nextDay_(day) {
  var d = new Date(String(day).slice(0, 10) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- mail

function headers_(payload) {
  var out = {};
  ((payload && payload.headers) || []).forEach(function (h) { out[String(h.name).toLowerCase()] = h.value; });
  return out;
}

// The plain-text body, or the HTML body with its tags removed.
function bodyText_(payload) {
  var plain = [], html = [];
  (function walk(part) {
    if (!part) return;
    var data = part.body && part.body.data;
    if (data && part.mimeType === 'text/plain') plain.push(decode_(data));
    else if (data && part.mimeType === 'text/html') html.push(decode_(data));
    (part.parts || []).forEach(walk);
  })(payload);
  if (plain.length) return plain.join('\n');
  return html.join('\n').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

function decode_(data) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8');
}

// ------------------------------------------------------------- plumbing

function props_() {
  return PropertiesService.getScriptProperties();
}

function roleFor_(key) {
  if (!key) return '';
  var p = props_();
  var app = p.getProperty('APP_KEY') || '';
  var claude = p.getProperty('CLAUDE_KEY') || '';
  if (!app || !claude) throw new Error('The gateway is not set up yet: run setup() in the script editor.');
  if (sameText_(key, claude)) return 'claude';
  if (sameText_(key, app)) return 'app';
  return '';
}

function request_(method, url, payload, contentType) {
  var r = { url: url, method: method, muteHttpExceptions: true,
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
  if (payload !== null && payload !== undefined) {
    r.payload = typeof payload === 'string' ? payload : JSON.stringify(payload);
    r.contentType = contentType || 'application/json';
  }
  return r;
}

// Calls a Google API with this script's own permissions. With soft=true a
// 404 returns null instead of failing.
function api_(method, url, payload, contentType, soft) {
  var res = UrlFetchApp.fetchAll([request_(method, url, payload, contentType)])[0];
  if (soft && res.getResponseCode() === 404) return null;
  return parse_(res);
}

function fetchText_(url) {
  var res = UrlFetchApp.fetchAll([request_('get', url)])[0];
  if (res.getResponseCode() >= 300) parse_(res);
  return res.getContentText();
}

function parse_(res) {
  var code = res.getResponseCode();
  var raw = res.getContentText() || '';
  var j = {};
  try { j = raw ? JSON.parse(raw) : {}; } catch (e) { j = {}; }
  if (code >= 200 && code < 300) return j;
  var said = (j.error && (j.error.message || j.error)) || raw.slice(0, 200);
  if (code === 403 && /insufficient|scope|permission/i.test(String(said))) {
    throw new Error('Google refused: the gateway has no permission for that (' + said + ').');
  }
  throw new Error('Google answered ' + code + ': ' + said);
}

function countThisHour_() {
  var cache = CacheService.getScriptCache();
  var key = 'calls-' + Math.floor(Date.now() / 3600000);
  var n = Number(cache.get(key) || 0);
  if (n >= MAX_PER_HOUR) throw new Error('The gateway already answered ' + MAX_PER_HOUR + ' calls this hour. Try again later.');
  cache.put(key, String(n + 1), 3700);
}

function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// 32 characters from an alphabet without look-alikes.
function newKey_() {
  var abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  var out = '';
  while (out.length < 32) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i + 1 < hex.length && out.length < 32; i += 2) {
      if (i === 12 || i === 16) continue;          // a UUID's fixed version/variant digits
      var v = parseInt(hex.substr(i, 2), 16);
      if (v < 216) out += abc[v % abc.length];   // 216 = 4 × 54: no bias
    }
  }
  return out;
}
