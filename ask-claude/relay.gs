/**
 * Ask Claude relay for the dashboard. Google Apps Script.
 *
 * What it does: the dashboard posts {action, passphrase, text} here. If the
 * passphrase matches, this script starts Ebbe's Claude scheduled task
 * ("Dashboard: Ask Claude") through its API trigger, with the text as the
 * run's payload, and answers with the new Claude session's address.
 *
 * Why it exists: Anthropic's trigger endpoint does not accept calls from web
 * pages (no CORS), and its token must not sit in a public repo or on a phone.
 * This script runs in Ebbe's own Google account and keeps the token in
 * Script Properties, which only he can see.
 *
 * Setup: README.md → "Set up Ask Claude", step 3. In short:
 *   1. script.google.com → New project → paste this whole file → Save.
 *   2. Project Settings → Script properties → add FIRE_URL and FIRE_TOKEN
 *      (from the scheduled task's API trigger).
 *   3. Run setup() once; allow access; copy the passphrase from the log.
 *   4. Deploy → New deployment → Web app; Execute as: Me; Who has access:
 *      Anyone. Copy the Web app address (ends in /exec).
 *   5. Paste the address and passphrase in the dashboard's Settings.
 *
 * Script properties used:
 *   FIRE_URL    https://api.anthropic.com/v1/claude_code/routines/<id>/fire
 *   FIRE_TOKEN  the task's API token (shown once when generated)
 *   PASSPHRASE  made by setup(); the dashboard sends it with every message
 */

var BETA_HEADER = 'experimental-cc-routine-2026-04-01';  // from Anthropic's /fire docs
var MAX_PER_HOUR = 20;      // Anthropic allows 30 fires per hour per task
var MAX_TEXT = 12000;       // characters

function doPost(e) {
  var out;
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var props = PropertiesService.getScriptProperties();
    var pass = props.getProperty('PASSPHRASE') || '';
    if (!pass) throw new Error('The relay is not set up yet: run setup() in the script editor.');
    if (!sameText_(String(body.passphrase || ''), pass)) {
      Utilities.sleep(1500);  // slows down guessing
      throw new Error('Wrong passphrase. Copy it again from the relay (run setup() to see it).');
    }

    if (body.action === 'ping') {
      out = { ok: true, ready: !!(props.getProperty('FIRE_URL') && props.getProperty('FIRE_TOKEN')) };
    } else if (body.action === 'ask') {
      var text = String(body.text || '').trim();
      if (!text) throw new Error('The message was empty.');
      if (text.length > MAX_TEXT) throw new Error('The message is too long for the relay (' + text.length + ' characters).');
      countThisHour_();
      out = fire_(props, text);
    } else {
      throw new Error('Unknown action.');
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Opening the Web app address in a browser shows this. It reveals nothing.
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, relay: 'dashboard-ask-claude' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor. Makes the passphrase (if there is none yet) and
// prints it, and says whether the Claude task is connected.
function setup() {
  var props = PropertiesService.getScriptProperties();
  var pass = props.getProperty('PASSPHRASE');
  if (!pass) {
    pass = newPassphrase_();
    props.setProperty('PASSPHRASE', pass);
  }
  Logger.log('Passphrase for the dashboard (Settings → Ask Claude connection): ' + pass);
  var url = props.getProperty('FIRE_URL') || '';
  var token = props.getProperty('FIRE_TOKEN') || '';
  if (!url || !token) {
    Logger.log('Not connected to Claude yet: add FIRE_URL and FIRE_TOKEN under Project Settings → Script properties.');
  } else if (!validFireUrl_(url)) {
    Logger.log('FIRE_URL does not look right. It should look like https://api.anthropic.com/v1/claude_code/routines/<id>/fire');
  } else {
    Logger.log('Connected to the Claude task. Run testFire() to send one test message.');
  }
}

// Optional: sends one test message to Claude, exactly as the dashboard would.
function testFire() {
  var props = PropertiesService.getScriptProperties();
  var r = fire_(props, 'Test message sent from the relay script, not from Ebbe. Reply "The relay works." and do nothing else.');
  Logger.log(JSON.stringify(r));
}

// Makes a new passphrase. The old one stops working, on every device.
function newPassphraseAndForgetOld() {
  PropertiesService.getScriptProperties().deleteProperty('PASSPHRASE');
  setup();
}

function fire_(props, text) {
  var url = props.getProperty('FIRE_URL') || '';
  var token = props.getProperty('FIRE_TOKEN') || '';
  if (!url || !token) throw new Error('The relay has no Claude task yet: add FIRE_URL and FIRE_TOKEN in its Script properties.');
  if (!validFireUrl_(url)) throw new Error('The relay\'s FIRE_URL does not look like a Claude task address.');
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token,
      'anthropic-beta': BETA_HEADER,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var raw = res.getContentText();
  var j = {};
  try { j = JSON.parse(raw); } catch (e) { /* not JSON */ }
  if (code >= 200 && code < 300) {
    return { ok: true, sessionUrl: j.claude_code_session_url || '', sessionId: j.claude_code_session_id || '' };
  }
  var said = (j.error && j.error.message) || raw.slice(0, 200);
  return { ok: false, status: code, error: explain_(code, said) };
}

function explain_(code, said) {
  if (code === 401) return 'Claude refused the token. It may have been regenerated: copy the new one into the relay\'s FIRE_TOKEN. (' + said + ')';
  if (code === 404) return 'Claude does not know this task. Check FIRE_URL in the relay. (' + said + ')';
  if (code === 429) return 'Too many messages this hour for the Claude task. Try again later. (' + said + ')';
  if (code === 400) return 'Claude did not accept the request. The trigger format may have changed; see README → Troubleshooting. (' + said + ')';
  if (code === 503 || code === 529) return 'Claude is busy right now. Try again in a minute.';
  return 'Claude answered ' + code + ': ' + said;
}

function validFireUrl_(url) {
  return /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/[A-Za-z0-9_-]+\/fire$/.test(url);
}

function countThisHour_() {
  var cache = CacheService.getScriptCache();
  var key = 'fires-' + Math.floor(Date.now() / 3600000);
  var n = Number(cache.get(key) || 0);
  if (n >= MAX_PER_HOUR) throw new Error('The relay already sent ' + MAX_PER_HOUR + ' messages this hour. Try again later.');
  cache.put(key, String(n + 1), 3700);
}

// Compares two strings without stopping at the first difference.
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// 24 characters from an alphabet without look-alikes, from a random UUID.
function newPassphrase_() {
  var abc = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  var out = '';
  while (out.length < 24) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i + 1 < hex.length && out.length < 24; i += 2) {
      if (i === 12 || i === 16) continue;          // a UUID's fixed version/variant digits
      var v = parseInt(hex.substr(i, 2), 16);
      if (v < 216) out += abc[v % abc.length];  // 216 = 4 × 54: no bias
    }
  }
  return out;
}
