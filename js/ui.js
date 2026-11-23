// Small helpers shared by the screens.

export const $ = (sel, root = document) => root.querySelector(sel);

// Escape text before putting it into innerHTML. Use it for every value that
// did not come from this file's own string literals.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clock(t) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dayAndClock(t) {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? clock(t) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + clock(t);
}

// Only http(s) links may become <a href>, so a stored value can never run code.
export function safeHref(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch (e) {
    return '';
  }
}
