// Runnable check (no framework): npx tsx web/src/lib/gitgraph.test.ts
// Covers the history graph's lane layout: a merge has to open a lane and the commit both sides reach
// has to close it again, or the graph creeps right forever and lines dangle. Hand-rolled eq() — the
// web workspace has no node types.
import { layout, laneCount, type Commit } from './gitgraph.js';

const eq = (got: unknown, want: unknown, what: string) => {
  const [a, b] = [JSON.stringify(got), JSON.stringify(want)];
  if (a !== b) throw new Error(`${what}: got ${a}, want ${b}`);
};
const c = (hash: string, ...parents: string[]): Commit =>
  ({ hash, short: hash, parents, author: 'a', email: 'a@x', date: '2026-01-01T00:00:00Z', subject: hash, refs: [] });

// --- straight line: one lane, every row on it ---
const linear = layout([c('c3', 'c2'), c('c2', 'c1'), c('c1')]);
eq(linear.map((r) => r.lane), [0, 0, 0], 'linear lanes');
eq(laneCount(linear), 1, 'linear width');
eq(linear[2].down, [], 'the root closes its lane');

// --- merge: m opens lane 1 for its second parent, and b5 (reached from both) closes it again ---
//   m ── b8 ── b7 ─┐
//    └── b6 ────── b5 ── b4
const g = layout([c('m', 'b8', 'b6'), c('b8', 'b7'), c('b7', 'b5'), c('b6', 'b5'), c('b5', 'b4'), c('b4')]);
eq(g.map((r) => r.lane), [0, 0, 0, 1, 0, 0], 'merge lanes');
eq(g[0].merges, [1], "the merge commit sends its 2nd parent into lane 1");
eq(g[4].joins, [1], 'the shared parent collapses lane 1');
eq(g[4].up, [0], 'the collapsed lane is a diagonal, not a vertical');
eq(g[4].down, [0], 'after the join only lane 0 continues');
eq(laneCount(g), 2, 'merge width');
eq(g[5].down, [], 'the root closes the last lane');

// --- an unrelated root after a closed lane reuses lane 0 instead of leaving a phantom ---
const two = layout([c('a2', 'a1'), c('a1'), c('z1')]);
eq(two.map((r) => r.lane), [0, 0, 0], 'a closed lane is reused, not abandoned');
eq(laneCount(two), 1, 'no phantom lane after a root');

eq(layout([]), [], 'empty history');

console.log('gitgraph: all checks passed');
