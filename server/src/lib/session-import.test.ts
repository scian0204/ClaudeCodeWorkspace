// Runnable check (no framework): npx tsx server/src/lib/session-import.test.ts
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeSlug, rewriteCwd, jsonlToMessages, cleanTitle, userTexts, listSessions } from './session-import.js';

// --- encodeSlug: replaces every non-alphanumeric with dash ---
assert.equal(encodeSlug('/data/users/u1/projects/MyProj'), '-data-users-u1-projects-MyProj');
assert.equal(encodeSlug('C:\\dev\\My.Proj_v2'), 'C--dev-My-Proj-v2');

// --- rewriteCwd: replaces cwd field, preserves other fields ---
{
  const line = JSON.stringify({ type: 'attachment', cwd: 'C:\\dev\\X', sessionId: 'a', gitBranch: 'main' });
  const out = JSON.parse(rewriteCwd(line, '/data/users/u1/projects/X'));
  assert.equal(out.cwd, '/data/users/u1/projects/X');
  assert.equal(out.sessionId, 'a');
  assert.equal(out.gitBranch, 'main');
}
// leaves lines without cwd untouched
{
  const line = JSON.stringify({ type: 'mode', sessionId: 'a' });
  assert.equal(rewriteCwd(line, '/x'), line);
}
// returns unparseable lines verbatim
assert.equal(rewriteCwd('not json', '/x'), 'not json');

// --- jsonlToMessages: user + assistant(text+tool_use) w/ merged tool_result, skips meta/sidechain ---
{
  const lines = [
    JSON.stringify({ type: 'custom-title', sessionId: 's', customTitle: 'T' }),
    JSON.stringify({ type: 'user', sessionId: 's', message: { role: 'user', content: 'hello' }, timestamp: '2026-01-01T00:00:00.000Z' }),
    JSON.stringify({ type: 'assistant', sessionId: 's', message: { role: 'assistant', content: [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
    ] }, timestamp: '2026-01-01T00:00:01.000Z' }),
    JSON.stringify({ type: 'user', isSidechain: true, message: { role: 'user', content: 'noise' } }),
    JSON.stringify({ type: 'user', sessionId: 's', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'file.txt', is_error: false },
    ] }, timestamp: '2026-01-01T00:00:02.000Z' }),
    JSON.stringify({ type: 'user', sessionId: 's', message: { role: 'user', content: 'next' }, timestamp: '2026-01-01T00:00:03.000Z' }),
  ];
  const msgs = jsonlToMessages(lines, 's');
  assert.deepEqual(msgs.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(msgs[0].content, { text: 'hello' });
  const blocks = msgs[1].content.blocks;
  assert.deepEqual(blocks[0], { type: 'text', text: 'hi' });
  // toMatchObject subset: block also carries `input`, so assert the expected fields individually
  assert.equal(blocks[1].type, 'tool_use');
  assert.equal(blocks[1].id, 't1');
  assert.equal(blocks[1].name, 'Bash');
  assert.equal(blocks[1].output, 'file.txt');
  assert.equal(blocks[1].isError, false);
  assert.deepEqual(msgs[2].content, { text: 'next' });
}

// --- cleanTitle: unwraps what a model (or a markdown first message) leads with, caps length ---
assert.equal(cleanTitle('## "Fix the auth bug"\nmore', 40), 'Fix the auth bug');
assert.equal(cleanTitle('  \n한글 제목입니다.', 40), '한글 제목입니다');
assert.equal(cleanTitle('abcdefghij', 4), 'abcd');
assert.equal(cleanTitle('', 40), '');

// --- userTexts: the user's side only, oldest first, capped ---
{
  const msgs = jsonlToMessages([
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'first' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'second' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'third' } }),
  ], 's');
  assert.deepEqual(userTexts(msgs, 10), ['first', 'second', 'third']);
  assert.deepEqual(userTexts(msgs, 2), ['first', 'second']);
}

// --- listSessions: custom-title wins; otherwise the title comes off the conversation, not the uuid ---
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-import-'));
  try {
    fs.writeFileSync(path.join(dir, 'aaaa-1111.jsonl'), [
      JSON.stringify({ type: 'custom-title', customTitle: 'Named by hand' }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'whatever' } }),
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'bbbb-2222.jsonl'), [
      JSON.stringify({ type: 'user', message: { role: 'user', content: '# 로그인 리다이렉트가 깨져요\n자세히는...' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }),
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'cccc-3333.jsonl'), JSON.stringify({ type: 'summary', summary: 'nothing usable' }));

    const byUuid = new Map(listSessions(dir, 40).map((s) => [s.uuid, s]));
    assert.equal(byUuid.get('aaaa-1111')!.title, 'Named by hand');
    assert.equal(byUuid.get('aaaa-1111')!.custom, true);
    assert.equal(byUuid.get('bbbb-2222')!.title, '로그인 리다이렉트가 깨져요');
    assert.equal(byUuid.get('bbbb-2222')!.custom, false);
    // no user text at all → still identifiable, falls back to the uuid
    assert.equal(byUuid.get('cccc-3333')!.title, 'cccc-3333');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

console.log('session-import: all checks passed');
