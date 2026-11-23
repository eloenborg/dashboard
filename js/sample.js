// A small made-up sample, so the views can be tried before Claude has
// organized anything real. Every item it makes has sample: true, so
// "Remove sample" takes away exactly these and nothing else.
// Neutral on purpose: no real things, people or places.

import { all, put, remove } from './data.js';
import { uid } from './store.js';

export function addSample() {
  if (all().some((it) => it.sample)) return false;
  const typeId = uid();
  const pageId = uid();
  put({ id: typeId, kind: 'type', sample: true, name: 'Sample item', plural: 'Sample items', fields: [
    { key: 'status', label: 'Status', type: 'status', options: [
      { key: 'wanted', label: 'Wanted', color: 'blue' }, { key: 'owned', label: 'Owned', color: 'green' },
      { key: 'low', label: 'Running low', color: 'amber' }, { key: 'gone', label: 'Used up', color: 'red' } ] },
    { key: 'group', label: 'Group', type: 'select', options: ['Group A', 'Group B', 'Group C'] },
    { key: 'qty', label: 'Quantity', type: 'quantity' },
    { key: 'price', label: 'Price', type: 'money', currency: 'EUR' },
    { key: 'rating', label: 'Rating', type: 'rating' },
    { key: 'done', label: 'Checked', type: 'checkbox' },
    { key: 'link', label: 'Goes with', type: 'link', to: typeId },
  ] });
  const ids = 'ABCDEFGH'.split('').map(() => uid());
  const rows = [
    ['wanted', 'Group A', 0, 4.5, 0], ['owned', 'Group A', 2, 4.5, 4], ['owned', 'Group B', 1, 12, 5],
    ['low', 'Group B', 1, 3.25, 3], ['wanted', 'Group C', 0, 20, 0], ['owned', 'Group C', 3, 7, 2],
    ['gone', 'Group A', 0, 4.5, 3], ['low', 'Group C', 1, 9.9, 4],
  ];
  rows.forEach(([status, group, qty, price, rating], i) => put({
    id: ids[i], kind: 'record', sample: true, type: typeId, title: 'Item ' + 'ABCDEFGH'[i], links: [],
    values: { status, group, qty, price: { amount: price, currency: 'EUR' }, rating: rating || null, done: i % 3 === 0, link: i ? [ids[i - 1]] : [] },
  }));
  const v1 = uid(), v2 = uid(), v3 = uid();
  put({ id: v1, kind: 'view', sample: true, title: 'All sample items', archetype: 'table', source: { type: typeId, filter: [], sort: [] }, show: [], keep: true, page: pageId });
  put({ id: v2, kind: 'view', sample: true, title: 'By status', archetype: 'board', source: { type: typeId, filter: [], sort: [], group: 'status' }, show: [], keep: true, page: pageId });
  put({ id: v3, kind: 'view', sample: true, title: 'Wanted', archetype: 'list', source: { type: typeId, filter: [{ field: 'status', op: 'is', value: 'wanted' }], sort: [{ field: 'price', dir: 'asc' }] }, show: ['group', 'price'], keep: true, page: pageId, pinned: true });
  put({ id: pageId, kind: 'page', sample: true, title: 'Sample collection', parent: null, order: 0, blocks: [
    { id: uid(), type: 'text', text: 'A made-up collection to try the views. Switch a view between Table, Board, List, Gallery and Checklist with the buttons above it. Tap an item to open it.' },
    { id: uid(), type: 'view', view: v1 },
    { id: uid(), type: 'h2', text: 'The same items as a board' },
    { id: uid(), type: 'view', view: v2 },
    { id: uid(), type: 'h2', text: 'Only the wanted ones' },
    { id: uid(), type: 'view', view: v3 },
    { id: uid(), type: 'todo', text: 'Try typing here: “- ” makes a list, “# ” a heading, “/” shows every block', checked: false },
    { id: uid(), type: 'text', text: '' },
  ] });
  return pageId;
}

export function removeSample() {
  const list = all().filter((it) => it.sample);
  for (const it of list) remove(it.id);
  return list.length;
}
