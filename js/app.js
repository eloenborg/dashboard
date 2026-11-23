// App shell: two screens (home and settings), switched by the address hash.

import { registerServiceWorker } from './update.js';
import { initHome, renderHome } from './home.js';
import { initSettings, renderSettings } from './settings.js';
import { loadData, startSync } from './data.js';
import { $ } from './ui.js';

const SCREENS = { home: renderHome, settings: renderSettings };

function current() {
  return location.hash === '#settings' ? 'settings' : 'home';
}

function show() {
  const name = current();
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== 'screen-' + name;
  $('#settingsBtn').setAttribute('aria-pressed', String(name === 'settings'));
  SCREENS[name]();
  window.scrollTo(0, 0);
}

function init() {
  $('#settingsBtn').addEventListener('click', () => {
    location.hash = current() === 'settings' ? '' : '#settings';
  });
  $('#brand').addEventListener('click', () => { location.hash = ''; });
  window.addEventListener('hashchange', show);

  initHome();
  initSettings();
  show();
  registerServiceWorker();
  loadData().then(startSync);
}

init();
