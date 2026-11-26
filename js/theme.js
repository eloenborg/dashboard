// Light or dark colours. Loaded as a plain script in <head>, before the page
// draws, so it never flashes the wrong colours. Dark is the default.
// The choice is per device: localStorage "dashboard.theme" = dark | light | auto.
(function () {
  var KEY = 'dashboard.theme';
  var BARS = { dark: '#15171C', light: '#FBFBF7' };
  function chosen() {
    try { var t = localStorage.getItem(KEY); if (t === 'light' || t === 'auto') return t; } catch (e) { /* blocked */ }
    return 'dark';
  }
  function apply(t) {
    var root = document.documentElement;
    root.setAttribute('data-theme', t);
    var shown = t === 'auto'
      ? (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BARS[shown]);
  }
  window.dashboardTheme = {
    get: chosen,
    set: function (t) {
      try { localStorage.setItem(KEY, t); } catch (e) { /* blocked: still apply for now */ }
      apply(t);
    },
  };
  apply(chosen());
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: light)');
    var again = function () { if (chosen() === 'auto') apply('auto'); };
    if (mq.addEventListener) mq.addEventListener('change', again);
  }
})();
