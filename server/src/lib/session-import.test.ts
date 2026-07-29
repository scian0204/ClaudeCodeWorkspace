// Runnable check (no framework): npx tsx server/src/lib/session-import.test.ts
import assert from 'node:assert';
import { encodeSlug, rewriteCwd, jsonlToMessages } from './session-import.js';

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

console.log('session-import: all checks passed');
