// Runnable check (no framework): npx tsx server/src/wiki/learn.test.ts
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseDecision, applyKnowledge } from './learn.js';
import { slugify } from './seed.js';

// ── parseDecision: the model's answer is free text, so every shape it actually produces must land ──
assert.equal(parseDecision('{"add": false}').add, false);
assert.equal(parseDecision('```json\n{"add": true, "title": "t", "content": "c"}\n```').title, 't'); // fenced
assert.equal(parseDecision('Sure!\n{"add": true, "title": "t", "content": "c"}\nHope that helps').add, true); // chatty
assert.equal(parseDecision('not json at all').add, false);  // garbage never becomes an addition
assert.equal(parseDecision('').add, false);
assert.equal(parseDecision('{"add": true, "title":').add, false); // truncated / unparseable

// ── slugify: the decided slug becomes a filename on disk ──
assert.equal(slugify('OAuth 토큰 회전'), 'OAuth-토큰-회전');
assert.equal(slugify('a/b:c*?.md'), 'abc.md');       // separators + reserved chars stripped
assert.equal(slugify('../../etc/passwd'), 'etcpasswd'); // no traversal survives
assert.equal(slugify(''), 'untitled');
assert.equal(slugify('...'), 'untitled');

// ── applyKnowledge: raw/ is the copy that survives a recompile, wiki/ the one queries can see ──
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikilearn-'));
const topic: any = { id: 't1', name: 'T', description: '', path: dir };
try {
  applyKnowledge(topic, { title: '토큰 회전', slug: 'token-rotation', content: '90일마다 회전한다.', sessionId: 's1' });

  const raw = fs.readFileSync(path.join(dir, 'raw', 'conversations', 'token-rotation.md'), 'utf8');
  const wiki = fs.readFileSync(path.join(dir, 'wiki', 'conversations', 'token-rotation.md'), 'utf8');
  assert.equal(raw, wiki);                       // both copies, same bytes
  assert.ok(raw.includes('# 토큰 회전'));
  assert.ok(raw.includes('90일마다 회전한다.'));

  // content that already opens with its own H1 must not end up with two stacked headings
  applyKnowledge(topic, { title: '만료', slug: 'expiry-h1', content: '# 만료 처리\n\n재발급한다.', sessionId: 's1' });
  const own = fs.readFileSync(path.join(dir, 'wiki', 'conversations', 'expiry-h1.md'), 'utf8');
  assert.equal((own.match(/^# /gm) || []).length, 1, own);
  assert.ok(own.startsWith('<sub>'), own);

  // the index is what a query reads first — a note nobody links is a note nobody finds
  const idx = () => fs.readFileSync(path.join(dir, 'wiki', '_index.md'), 'utf8');
  assert.ok(idx().includes('- [토큰 회전](./conversations/token-rotation.md)'));

  // a second note joins the same section; re-applying the first one does not duplicate its line
  applyKnowledge(topic, { title: '만료 처리', slug: 'expiry', content: '만료 시 재발급.', sessionId: 's1' });
  applyKnowledge(topic, { title: '토큰 회전', slug: 'token-rotation', content: '90일마다 회전한다.', sessionId: 's2' });
  assert.equal(idx().split('## 대화에서 추가된 지식').length, 2);              // one section
  assert.equal(idx().split('](./conversations/token-rotation.md)').length, 2); // one link for it
  assert.ok(idx().includes('](./conversations/expiry.md)'));

  // an existing compiled index keeps its content — the section is appended, nothing is overwritten
  fs.writeFileSync(path.join(dir, 'wiki', '_index.md'), '# 인덱스\n\n- [기존](./old.md)\n', 'utf8');
  applyKnowledge(topic, { title: '새 지식', slug: 'fresh', content: 'x', sessionId: 's3' });
  assert.ok(idx().includes('- [기존](./old.md)'));
  assert.ok(idx().includes('](./conversations/fresh.md)'));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('wiki/learn: ok');
