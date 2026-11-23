// Settings: the version with Force update, and the Ask Claude connection.

import { storageFull } from './store.js';
import * as data from './data.js';
import { addSample, removeSample } from './sample.js';
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

  $('#setupDataLink').href = 'https://github.com/' + REPO + '#set-up-the-data-on-google-drive';
  $('#setGwSave').addEventListener('click', saveAndTestGateway);
  $('#setGwSync').addEventListener('click', () => data.syncNow());
  $('#setGwForget').addEventListener('click', async () => {
    if (!confirm('Disconnect this device from Google Drive and remove its copy of your data? Your data on Drive stays as it is.')) return;
    data.setGatewayConfig({});
    await data.forgetDeviceCopy();
    renderSettings();
    $('#setGwResult').textContent = 'Disconnected, and this device\'s copy is removed.';
  });
  document.addEventListener('dashboard:sync', renderDataState);

  $('#setSampleAdd').addEventListener('click', () => {
    const id = addSample();
    if (id) location.hash = '#p/' + id;
    else $('#setSampleResult').textContent = 'The sample page is already there. Look for “Sample collection” in your pages.';
  });
  $('#setSampleRemove').addEventListener('click', () => {
    const n = removeSample();
    $('#setSampleResult').textContent = n ? 'Removed the sample page and its made-up items.' : 'There is no sample to remove.';
  });
}

export function dataStateText() {
  const n = data.pendingCount();
  const waiting = n ? ' ' + n + ' change' + (n === 1 ? '' : 's') + ' waiting to be sent.' : '';
  if (!data.isDataConnected()) {
    return 'Not connected on this device. What you add is saved on this device only until you connect.';
  }
  const s = data.sync;
  if (s.state === 'syncing') return 'Connected. Syncing with Google Drive…' + waiting;
  if (s.state === 'offline') return 'Connected, but offline. Changes are kept here and sent later.' + waiting;
  if (s.state === 'error') return 'Connected, but the last sync failed: ' + s.error + waiting;
  if (s.lastSync) return 'Connected. Last synced with Google Drive at ' + new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.' + waiting;
  return 'Connected.' + waiting;
}

function renderDataState() {
  const el = $('#setDataState');
  if (!el) return;
  el.textContent = dataStateText();
  el.className = data.sync.state === 'error' ? 'bad' : '';
  $('#setGwSync').hidden = !data.isDataConnected();
}

async function saveAndTestGateway() {
  const url = $('#setGwUrl').value.trim();
  const key = $('#setGwKey').value.trim();
  const out = $('#setGwResult');
  out.className = 'status';
  if (url && !data.validGatewayUrl(url)) {
    out.className = 'status bad';
    out.textContent = 'That does not look like a Web app address. It starts with https://script.google.com/macros/s/ and ends in /exec.';
    return;
  }
  data.setGatewayConfig({ url, key });
  renderDataState();
  if (!url || !key) {
    out.textContent = 'Saved. Add both the address and the app key to connect.';
    return;
  }
  const btn = $('#setGwSave');
  btn.disabled = true;
  btn.textContent = 'Testing…';
  try {
    out.textContent = await data.testGateway();
    data.syncNow();
  } catch (e) {
    if (/Claude key/.test(e.message)) data.setGatewayConfig({});
    out.className = 'status bad';
    out.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save and test';
    renderDataState();
  }
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

  const g = data.gatewayConfig();
  $('#setGwUrl').value = g.url || '';
  $('#setGwKey').value = g.key || '';
  $('#setGwResult').textContent = '';
  renderDataState();

  const c = askConfig();
  $('#setRelayUrl').value = c.url || '';
  $('#setRelayPass').value = c.pass || '';
  $('#setAskState').textContent = isConnected()
    ? 'Connected on this device. Ask Claude sends messages straight to Claude.'
    : 'Not connected on this device. Ask Claude opens the Claude app instead, and you tap send there.';
  $('#setAskResult').textContent = '';
  $('#setAskResult').className = 'status';

  $('#setStorage').hidden = !storageFull && !data.deviceCopyFailed;
  $('#setSampleResult').textContent = '';
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
