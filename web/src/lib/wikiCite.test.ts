// Runnable check (no framework): cd web && npx tsx src/lib/wikiCite.test.ts
import assert from 'node:assert';
import { realPath, extractSources, resolveSource, type TopicTree } from './wikiCite';
import type { Block } from './store';

const tree: TopicTree = {
  wiki: ['_index.md', 'refunds.md', 'conversations/token-rotation.md'],
  raw: ['gateway  notes.md', 'img/flow.png'], // note the double space — the model normalizes it away
};

// ── realPath: snap an approximate path, drop one with no file behind it ──
assert.deepEqual(realPath(tree, { dir: 'wiki', path: 'refunds.md' }), { dir: 'wiki', path: 'refunds.md' });
// the model writes single spaces, so a name with a double space still has to resolve
assert.deepEqual(realPath(tree, { dir: 'raw', path: 'gateway notes.md' }), { dir: 'raw', path: 'gateway  notes.md' });
// a bare basename resolves to the nested file it names
assert.deepEqual(realPath(tree, { dir: 'wiki', path: 'token-rotation.md' }), { dir: 'wiki', path: 'conversations/token-rotation.md' });
// nothing on disk → dropped, so the panel never lists a source nobody can open
assert.equal(realPath(tree, { dir: 'wiki', path: 'invented.md' }), null);
assert.equal(realPath(tree, { dir: 'raw', path: 'refunds.md' }), null); // right name, wrong dir
// list not loaded yet → keep it; the filter re-runs when the list lands
assert.deepEqual(realPath(null, { dir: 'wiki', path: 'invented.md' }), { dir: 'wiki', path: 'invented.md' });

// ── resolveSource: a Read path under the topic dir becomes a topic-relative source ──
const T = 'topic123';
assert.deepEqual(resolveSource(`/data/wiki/${T}/wiki/refunds.md`, T), { dir: 'wiki', path: 'refunds.md' });
assert.deepEqual(resolveSource(`/data/wiki/${T}/raw/img/flow.png`, T), { dir: 'raw', path: 'img/flow.png' });
assert.equal(resolveSource(`/data/wiki/${T}/CLAUDE.md`, T), null); // the grounding doc is not a source

// ── extractSources: Read calls + paths named in prose, filtered through the tree ──
const blocks: Block[] = [
  { type: 'tool_use', id: '1', name: 'Read', input: { file_path: `/data/wiki/${T}/wiki/refunds.md` } },
  { type: 'tool_use', id: '2', name: 'Read', input: { file_path: `/data/wiki/${T}/wiki/gone.md` } },
  { type: 'text', text: '환불은 wiki/refunds.md 에 있고 원본은 raw/gateway notes.md 다. wiki/nope.md 는 없다.' },
];
const got = extractSources(blocks, T, tree);
assert.deepEqual(got, [
  { dir: 'wiki', path: 'refunds.md' },          // read once, named again → one entry
  { dir: 'raw', path: 'gateway  notes.md' },    // snapped to the real name
]);
// a Read that pointed at nothing, and every phantom path, stay out
assert.ok(!got.some((s) => s.path.includes('gone') || s.path.includes('nope')));

// unfiltered (no tree yet) keeps everything it found, so nothing flickers away before the list loads
assert.equal(extractSources(blocks, T).length, 4);

console.log('lib/wikiCite: ok');
