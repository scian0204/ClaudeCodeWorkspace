// Runnable check (no framework): npx tsx server/src/routes/wiki.test.ts
import assert from 'node:assert';
import { safeRelPath, isText, groundingDoc } from './wiki.js';

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

// ── groundingDoc: the answer rules must follow the topic's kind and learning mode ──
{
  const m = groundingDoc('T', '', 'auto', 'minutes');
  assert.ok(m.includes('./wiki/meetings/'));                       // per-meeting docs are the evidence
  assert.ok(m.includes('decisions.md') && m.includes('actions.md')); // registers announced
  assert.ok(m.includes('기록에 없습니다'));                          // meeting facts are never invented...
  assert.ok(!m.includes('네 지식으로 이어서 답해라'));                 // ...even in growing mode
  assert.ok(m.includes('알아서 기록한다'));                           // growing minutes: capture is automatic
  assert.ok(!groundingDoc('T', '', 'off', 'minutes').includes('알아서 기록한다'));
  assert.ok(groundingDoc('T', '', 'auto', 'wiki').includes('네 지식으로 이어서 답해라')); // wiki growing unchanged
  assert.ok(groundingDoc('T', '', 'off').includes('이 위키에는 해당 내용이 없습니다'));   // wiki strict unchanged
  for (const doc of [m, groundingDoc('T', '', 'off'), groundingDoc('T', '', 'auto', 'wiki')]) {
    assert.ok(doc.includes('답변 형식'));                            // the format rules apply everywhere
  }
}

console.log('routes/wiki: ok');
