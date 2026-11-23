// Settings: the version with Force update, and the Ask Claude connection.

import { storageFull } from './store.js';
import { BUILD } from './version.js';
import { onlineBuild, forceUpdate } from './update.js';
import { askConfig, setAskConfig, isConnected, testConnection } from './ask.js';
import { REPO } from './config.js';
import { $, esc } from './ui.js';

export function initSettings() {
  $('#setForce').addEventListener('click', () => {
    $('#setForce').textContent = 'Updating…';
    forceUpdate();
  });
  $('#setAskSave').addEventListener('click', saveAndTest);
  $('#setAskForget').addEventListener('click', () => {
    if (!confirm('Remove the relay address and passphrase from this device?')) return;
    setAskConfig({});
    renderSettings();
    $('#setAskResult').textContent = 'Removed from this device.';
  });
  $('#setupLink').href = 'https://github.com/' + REPO + '#set-up-ask-claude';
}

export function renderSettings() {
  $('#setBuild').textContent = 'v' + BUILD;
  $('#setOnline').textContent = 'Checking the web…';
  onlineBuild().then((online) => {
    const el = $('#setOnline');
    if (online === null) el.textContent = 'Could not reach the web to compare.';
    else if (online > BUILD) el.innerHTML = 'The web has <b>v' + esc(online) + '</b>. Tap Force update to get it.';
    else el.textContent = 'This is the newest version online.';
  });

  const c = askConfig();
  $('#setRelayUrl').value = c.url || '';
  $('#setRelayPass').value = c.pass || '';
  $('#setAskState').textContent = isConnected()
    ? 'Connected on this device. Ask Claude sends messages straight to Claude.'
    : 'Not connected on this device. Ask Claude opens the Claude app instead, and you tap send there.';
  $('#setAskResult').textContent = '';
  $('#setAskResult').className = 'status';

  $('#setStorage').hidden = !storageFull;
}

async function saveAndTest() {
  const url = $('#setRelayUrl').value.trim();
  const pass = $('#setRelayPass').value.trim();
  const out = $('#setAskResult');
  out.className = 'status';
  if (url && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    out.className = 'status bad';
    out.textContent = 'That does not look like a Web app address. It starts with https://script.google.com/macros/s/ and ends in /exec.';
    return;
  }
  setAskConfig({ url, pass });
  renderSettings();
  if (!url || !pass) {
    out.textContent = 'Saved. Add both the address and the passphrase to connect.';
    return;
  }
  const btn = $('#setAskSave');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  try {
    out.textContent = await testConnection();
  } catch (e) {
    out.className = 'status bad';
    out.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save and test';
  }
}
