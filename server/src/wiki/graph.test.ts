// Runnable check (no framework): npx tsx server/src/wiki/graph.test.ts
// Link resolution for the wiki graph. The compile prompt writes the SAME link twice ([[x]] and
// [x](./x.md)) and articles link back at each other, so the easy way to break this is a graph with
// every line drawn two to four times. The other traps: a link into a subfolder, a relative ../ path,
// and a link to an article that was never written (must be dropped, not turned into a ghost node).
import assert from 'node:assert';
import { buildGraph } from './graph.js';

const f = (path: string, content: string) => ({ path, content });
const pairs = (g: ReturnType<typeof buildGraph>) => g.edges.map((e) => [e.source, e.target].sort().join(' > ')).sort();

// --- the shape the compiler actually produces: both link forms, both directions ---
const both = buildGraph([
  f('_index.md', '- [[overview]] ([overview](./overview.md))\n- [[refunds]] ([refunds](./refunds.md))'),
  f('overview.md', 'See [[refunds]] ([refunds](./refunds.md)) for the state machine.'),
  f('refunds.md', 'Part of [[overview]] ([overview](./overview.md)).'),
]);
assert.deepStrictEqual(pairs(both), ['_index.md > overview.md', '_index.md > refunds.md', 'overview.md > refunds.md'],
  'one line per pair, however many times the two articles link at each other');
assert.strictEqual(both.nodes.find((n) => n.id === '_index.md')!.deg, 2, 'index degree');
assert.strictEqual(both.nodes.find((n) => n.id === 'refunds.md')!.deg, 2, 'refunds degree');
assert.deepStrictEqual(both.nodes.map((n) => n.label), ['_index', 'overview', 'refunds'], 'labels drop the extension');

// --- folders: a bare [[name]] finds an article in a subfolder, and ../ resolves upward ---
const nested = buildGraph([
  f('_index.md', 'Start at [[ledger]].'),
  f('accounting/ledger.md', 'Back to [../_index.md](../_index.md), sibling [[accounting/journal]].'),
  f('accounting/journal.md', ''),
]);
assert.deepStrictEqual(pairs(nested), ['_index.md > accounting/ledger.md', 'accounting/journal.md > accounting/ledger.md'],
  'bare name, ../ path and a full path all resolve');

// --- nothing on disk behind the link, and nothing pointing at itself ---
const loose = buildGraph([
  f('a.md', '[[b]] [[a]] [x](https://example.com/y.md) ![img](./raw/diagram.png) [c](./c.md)'),
  f('b.md', ''),
]);
assert.deepStrictEqual(pairs(loose), ['a.md > b.md'], 'dangling, external, image and self links are dropped');

// --- non-markdown files are not articles; an empty wiki is an empty graph ---
assert.deepStrictEqual(buildGraph([f('notes.txt', '[[a]]'), f('a.md', '')]).nodes.map((n) => n.id), ['a.md'], 'only markdown is a node');
assert.deepStrictEqual(buildGraph([]), { nodes: [], edges: [] }, 'empty wiki');

console.log('wiki graph: all checks passed');
