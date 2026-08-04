// Runnable check (no framework): npx tsx web/src/lib/ctxrows.test.ts
// Covers the part of the right-click menu with no DOM in it: how the groups merge, and what a
// mirrored control ends up being called. Hand-rolled eq() instead of node:assert — the web workspace
// has no node types, and this still exits non-zero on failure.
import { composeRows, actionLabel, type CtxRow } from './ctxrows.js';

const eq = (got: unknown, want: unknown, what: string) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) throw new Error(`${what}: got ${a}, want ${b}`);
};
const item = (label: string): CtxRow => ({ label, onSelect: () => {} });
const labels = (rows: CtxRow[]) => rows.map((r) => (r === '-' ? '-' : r.label));

// groups are separated by exactly one rule; falsy entries vanish
eq(labels(composeRows([item('a'), false, item('b')], [item('c')])), ['a', 'b', '-', 'c'], 'two groups');
// an empty group leaves no rule behind (nothing between the two real groups but one separator)
eq(labels(composeRows([item('a')], [null, false], [item('b')])), ['a', '-', 'b'], 'empty group');
// the earlier group wins a duplicate label — a surface's own "Delete" beats the mirrored button
const own = item('Delete');
if (composeRows([own], [item('Delete')])[0] !== own) throw new Error('dedup kept the wrong row');
eq(labels(composeRows([own], [item('Delete')])), ['Delete'], 'dedup');
// separators inside a group collapse, and never lead or trail it
eq(labels(composeRows(['-', item('a'), '-', '-', item('b'), '-'])), ['a', '-', 'b'], 'separators');
// a group emptied by dedup does not open a rule of its own
eq(labels(composeRows([item('a')], [item('a')], [item('b')])), ['a', '-', 'b'], 'group emptied by dedup');
eq(composeRows([], [false]), [], 'nothing at all');

// label: aria-label first, then title, then the control's own text; whitespace squashed
const el = (attrs: Record<string, string>, text = '') => ({
  getAttribute: (n: string) => attrs[n] ?? null,
  textContent: text,
});
eq(actionLabel(el({ 'aria-label': 'Rename chat', title: 'ignored' })), 'Rename chat', 'aria-label wins');
eq(actionLabel(el({ title: 'Delete room' })), 'Delete room', 'title');
eq(actionLabel(el({}, '  Detail\n ')), 'Detail', 'own text');
eq(actionLabel(el({}, '')), '', 'unlabelled icon button → not mirrored');
eq(actionLabel(el({ 'aria-label': 'x'.repeat(80) })).length, 60, 'label capped');

console.log('ok');
