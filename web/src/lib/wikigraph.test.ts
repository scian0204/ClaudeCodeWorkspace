// Runnable check (no framework): npx tsx web/src/lib/wikigraph.test.ts
// Placement for the wiki link graph. Three things it must not lose: the same wiki draws the same way
// every time (a random start would reshuffle the picture on every open), linked articles end up
// nearer each other than unlinked ones (otherwise the drawing says nothing), and nothing lands
// outside the frame or on NaN. Hand-rolled eq() — the web workspace has no node types.
import { layout, bounds, type GraphNode, type GraphEdge } from './wikigraph.js';

const fail = (what: string) => { throw new Error(what); };
const nd = (id: string, deg = 0): GraphNode => ({ id, label: id, deg });
const ed = (source: string, target: string): GraphEdge => ({ source, target });
const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);

// two tight clusters, joined by nothing
const nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => nd(id, 2));
const edges = [ed('a1', 'a2'), ed('a2', 'a3'), ed('a3', 'a1'), ed('b1', 'b2'), ed('b2', 'b3'), ed('b3', 'b1')];
const placed = layout(nodes, edges);
const by = Object.fromEntries(placed.map((p) => [p.id, p]));

if (JSON.stringify(placed) !== JSON.stringify(layout(nodes, edges))) fail('same input must place the same way twice');
for (const p of placed) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) fail(`${p.id} landed on NaN`);
  if (p.x < 0 || p.x > 1000 || p.y < 0 || p.y > 1000) fail(`${p.id} left the frame`);
}
const linked = dist(by.a1, by.a2), unlinked = dist(by.a1, by.b1);
if (!(linked < unlinked)) fail(`linked articles must sit closer (${linked.toFixed(1)} vs ${unlinked.toFixed(1)})`);

// an article nothing links to still gets a place of its own, not a spot on top of another
const withOrphan = layout([...nodes, nd('orphan')], edges);
const lone = withOrphan.find((p) => p.id === 'orphan')!;
if (!Number.isFinite(lone.x)) fail('an unlinked article must still be placed');
if (withOrphan.some((p) => p.id !== 'orphan' && dist(p, lone) < 1)) fail('an unlinked article must not stack on another');

// nodes that start at the same spot must not divide by zero — 1 node, and the empty graph
if (!Number.isFinite(layout([nd('only')], [])[0].x)) fail('single node');
if (layout([], []).length) fail('empty graph places nothing');

const b = bounds(placed);
if (!placed.every((p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)) fail('bounds must contain every node');
if (bounds([]).w !== 1) fail('empty bounds must stay drawable');

console.log('wikigraph: all checks passed');
