// Public holidays and seasons, worked out from the date alone, so the
// calendar can show them for any year, offline. General rules per country;
// which country is set in js/config.js (COUNTRY).
//
//   holidays(year, country) -> [{ date: 'YYYY-MM-DD', name, group, off }]
//     off:   a day off for most people (a public holiday)
//     group: days that belong together (Easter, Christmas), so a crowded
//            view can show them under one name
//   seasons(year) -> [{ key, name, start, end }]   (end is the last day)

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);

// Easter Sunday (Gregorian), as [month, day].
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

// Rules: fixed dates [month, day, name, off, group], days counted from
// Easter Sunday [offset, name, off, group], and the nth weekday of a month
// [month, weekday (0 = Sunday), n, name, off, group].
const RULES = {
  DK: {
    fixed: [
      [1, 1, 'Nytårsdag', true, 'Nytår'],
      [6, 5, 'Grundlovsdag', true],
      [6, 23, 'Sankthansaften', false],
      [11, 10, 'Mortensaften', false],
      [12, 24, 'Juleaften', true, 'Jul'],
      [12, 25, 'Juledag', true, 'Jul'],
      [12, 26, '2. juledag', true, 'Jul'],
      [12, 31, 'Nytårsaften', false, 'Nytår'],
    ],
    easter: [
      [-49, 'Fastelavn', false],
      [-3, 'Skærtorsdag', true, 'Påske'],
      [-2, 'Langfredag', true, 'Påske'],
      [0, 'Påskedag', true, 'Påske'],
      [1, '2. påskedag', true, 'Påske'],
      [39, 'Kristi himmelfartsdag', true, 'Kr. himmelfart'],
      [49, 'Pinsedag', true, 'Pinse'],
      [50, '2. pinsedag', true, 'Pinse'],
    ],
    nth: [
      [5, 0, 2, 'Mors dag', false],
    ],
  },
};

const cache = new Map();

export function holidays(year, country = 'DK') {
  const key = country + year;
  if (cache.has(key)) return cache.get(key);
  const r = RULES[country];
  const out = [];
  if (r) {
    for (const [m, d, name, off, group] of r.fixed || []) out.push({ date: ymd(year, m, d), name, off: !!off, group: group || name });
    const [em, ed] = easter(year);
    for (const [n, name, off, group] of r.easter || []) {
      const t = new Date(Date.UTC(year, em - 1, ed + n));
      out.push({ date: ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), name, off: !!off, group: group || name });
    }
    for (const [m, wd, n, name, off, group] of r.nth || []) {
      const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
      const day = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
      out.push({ date: ymd(year, m, day), name, off: !!off, group: group || name });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  cache.set(key, out);
  return out;
}

// Meteorological seasons (whole months), the usual split in northern Europe.
export function seasons(year) {
  const last = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [
    { key: 'winter', name: 'Winter', start: ymd(year - 1, 12, 1), end: ymd(year, 2, last(year, 2)) },
    { key: 'spring', name: 'Spring', start: ymd(year, 3, 1), end: ymd(year, 5, 31) },
    { key: 'summer', name: 'Summer', start: ymd(year, 6, 1), end: ymd(year, 8, 31) },
    { key: 'autumn', name: 'Autumn', start: ymd(year, 9, 1), end: ymd(year, 11, 30) },
    { key: 'winter', name: 'Winter', start: ymd(year, 12, 1), end: ymd(year + 1, 2, last(year + 1, 2)) },
  ];
}

export function seasonOf(month) {   // month 1-12
  return month === 12 || month <= 2 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'autumn';
}
