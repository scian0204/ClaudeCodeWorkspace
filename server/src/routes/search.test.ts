// Runnable check (no framework): npx tsx server/src/routes/search.test.ts
import assert from 'node:assert';
import { messageText, snippet, escapeLike } from './search.js';

// ── messageText: every searchable surface of a stored message ──
assert.equal(messageText({ text: 'refactor the auth middleware' }), 'refactor the auth middleware');
const claude = {
  blocks: [
    { type: 'text', text: 'Found two call sites.' },
    { type: 'tool_use', name: 'Bash', input: { command: 'grep -rn "verifyToken(" src/' }, output: 'src/auth/middleware.ts:14' },
  ],
};
const flat = messageText(claude);
assert.ok(flat.includes('Found two call sites.'));   // assistant prose
assert.ok(flat.includes('Bash'));                     // tool name
assert.ok(flat.includes('verifyToken'));              // tool input
assert.ok(flat.includes('src/auth/middleware.ts'));   // tool output
// garbage / legacy shapes never throw
assert.equal(messageText(null), '');
assert.equal(messageText({ blocks: 'nope' }), '');
// oversized parts are truncated, not slurped whole
assert.ok(messageText({ blocks: [{ type: 'text', text: 'x'.repeat(10_000) }] }).length < 5000);

// ── snippet: excerpt centred on the match, whitespace collapsed ──
const long = `${'a'.repeat(300)} NEEDLE ${'b'.repeat(300)}`;
const s = snippet(long, 'needle', 60);
assert.ok(s.includes('NEEDLE'));                      // case-insensitive locate, original case kept
assert.ok(s.startsWith('…') && s.endsWith('…'));      // both sides elided
assert.ok(s.length <= 62);
assert.equal(snippet('  multi\n\n  line   text ', 'line', 40), 'multi line text'); // collapsed, no ellipsis
// needle absent (match came from a sibling field) → head of the text
assert.equal(snippet('short text', 'zzz', 40), 'short text');

// ── escapeLike: user-typed wildcards must not widen the LIKE match ──
assert.equal(escapeLike('100%'), '100\\%');
assert.equal(escapeLike('a_b'), 'a\\_b');
assert.equal(escapeLike('C:\\dev'), 'C:\\\\dev');
assert.equal(escapeLike('plain'), 'plain');

console.log('search: ok');
