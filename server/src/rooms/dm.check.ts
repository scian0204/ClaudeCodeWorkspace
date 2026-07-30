// Runnable self-check for the DM logic that could silently break: 1:1 dedupe + membership gating.
// No test framework — run directly:  npx tsx src/rooms/dm.check.ts   (from server/)
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// point every data path at a throwaway dir BEFORE importing modules that read config at load time
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ccw-dm-'));
process.env.TOKEN_ENC_SECRET = process.env.TOKEN_ENC_SECRET || 'x'.repeat(32);

const { initDb } = await import('../db/index.js');
const { createUser } = await import('../auth/index.js');
const dm = await import('./dm.js');

initDb();
const a = createUser({ username: `a_${Date.now()}`, password: 'pw' });
const b = createUser({ username: `b_${Date.now()}`, password: 'pw' });
const c = createUser({ username: `c_${Date.now()}`, password: 'pw' }); // not a DM member

// createDm dedupes the 1:1 channel (same pair, either order → same channel)
const ch1 = dm.createDm(a.id, b.id);
const ch2 = dm.createDm(b.id, a.id);
assert.equal(ch1.id, ch2.id, 'createDm must reuse the existing 1:1 channel');

// postMessage / listMessages reject a non-member
assert.equal(dm.postMessage(ch1.id, c.id, 'sneak'), null, 'postMessage must reject a non-member');
assert.equal(dm.listMessages(ch1.id, c.id), null, 'listMessages must reject a non-member');

// a real member can post and read it back
assert.ok(dm.postMessage(ch1.id, a.id, 'hello'), 'member post should succeed');
const msgs = dm.listMessages(ch1.id, b.id);
assert.ok(msgs && msgs.length === 1 && msgs[0].text === 'hello', 'member should read the message');

console.log('dm.check: OK');
