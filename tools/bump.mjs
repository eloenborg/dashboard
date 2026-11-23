#!/usr/bin/env node
// Raises the app version by one (BUILD in js/version.js).
// Run it in every change you push: Settings and the "new version" note
// compare this number with the one online, and the service worker's cache is
// named after it.
//
//   node tools/bump.mjs

import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../js/version.js', import.meta.url);
const src = readFileSync(file, 'utf8');
const m = /export const BUILD = (\d+);/.exec(src);
if (!m) {
  console.error('Could not find "export const BUILD = <number>;" in js/version.js');
  process.exit(1);
}
const next = Number(m[1]) + 1;
writeFileSync(file, src.replace(m[0], `export const BUILD = ${next};`));
console.log(`version v${m[1]} -> v${next}`);
