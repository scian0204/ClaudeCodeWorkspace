// Runnable check (no framework): npx tsx server/src/routes/wiki.test.ts
import assert from 'node:assert';
import { safeRelPath, isText } from './wiki.js';

// ── safeRelPath: the only thing standing between a client path and the topic dir ──
assert.equal(safeRelPath('notes/spec.md'), 'notes/spec.md');       // nested path kept
assert.equal(safeRelPath('a\\b\\c.md'), 'a/b/c.md');               // windows separators normalized
assert.equal(safeRelPath('../../etc/passwd'), 'etc/passwd');       // traversal segments dropped
assert.equal(safeRelPath('..'), '');                               // nothing but traversal → refused
assert.equal(safeRelPath('/CLAUDE.md'), 'CLAUDE.md');              // absolute → relative
assert.equal(safeRelPath('./x/./y.md'), 'x/y.md');                 // '.' segments dropped
assert.equal(safeRelPath('한글 문서.md'), '한글 문서.md');            // unicode filenames survive
assert.equal(safeRelPath('a/\x00b.md'), 'a/b.md');                 // control chars stripped

// ── isText: gate for the in-place source editor (PUT /topics/:id/file) ──
for (const n of ['a.md', 'a.markdown', 'a.txt', 'a.json', 'a.yml', 'a.yaml', 'a.csv', 'a.tsv', 'A.MD'])
  assert.ok(isText(n), n);
for (const n of ['a.png', 'a.pdf', 'a.md.png', 'a', 'a.mdx'])
  assert.ok(!isText(n), n);

console.log('wiki: ok');
