// Runnable check (no framework): npx tsx server/src/admin/requests.test.ts
// Guards the two security-critical properties of the approval framework:
//   1. role_upgrade promotes the REQUESTER, never a payload-named target (no escalation of others).
//   2. decideRequest executes an action AT MOST ONCE (a second decide throws, no double effect).
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';

// DATA_DIR must be set before anything imports config.ts (paths.ts reads it at module load), so we
// dynamic-import the DB + logic after pointing at a throwaway temp dir.
process.env.DATA_DIR = path.join(os.tmpdir(), `ccw-req-test-${Date.now()}`);

const { initDb, db, schema } = await import('../db/index.js');
initDb();
const { createUser, getUserById } = await import('../auth/index.js');
const { submitRequest, decideRequest, ACTIONS } = await import('./requests.js');

// role_upgrade declares no payload fields — it cannot even accept a target.
assert.deepEqual(ACTIONS.role_upgrade.fields, [], 'role_upgrade must take no payload fields');

const requester = createUser({ username: `m_${Date.now()}`, password: 'x', role: 'member' });
const victim = createUser({ username: `v_${Date.now()}`, password: 'x', role: 'member' });
const admin = createUser({ username: `a_${Date.now()}`, password: 'x', role: 'admin' });

// requester asks to be upgraded, but maliciously names the VICTIM in the payload
const req = submitRequest(requester, 'role_upgrade', { userId: victim.id, target: victim.id }, 'please');
assert.equal(req.status, 'pending');

const decided = await decideRequest(admin, req.id, true);
assert.equal(decided.status, 'approved');
// property 1: the REQUESTER was promoted; the payload-named victim was NOT touched
assert.equal(getUserById(requester.id)!.role, 'admin', 'requester must be promoted');
assert.equal(getUserById(victim.id)!.role, 'member', 'payload-named target must NOT be promoted');

// property 2: deciding the same (now non-pending) request again throws and changes nothing
await assert.rejects(() => decideRequest(admin, req.id, true), /already decided/, 'decide must be idempotent');

// unknown action types are rejected at submit time
assert.throws(() => submitRequest(requester, 'not_a_real_action', {}, ''), /unknown action/);

console.log('requests: ok');
