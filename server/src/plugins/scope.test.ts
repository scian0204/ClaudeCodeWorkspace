// Runnable check (no framework): npx tsx server/src/plugins/scope.test.ts
// What a session actually loads. The three scopes overlap on purpose (common + the session's own
// project + the owner's personal ones), so this pins the rules that are easy to break: a forced
// common plugin ignores the user's preference, a disabled row never loads, and a project's plugins
// reach every session of that project — but no session of another project.
import assert from 'node:assert';
import { selectPluginPaths, type PluginRowLike } from './manager.js';

let n = 0;
const row = (scope: string, ownerId: string | null, projectId: string, enabled = 1, forced = 0): PluginRowLike => {
  const id = `pl_${++n}`;
  return { id, scope, ownerId, projectId, path: `/plugins/${id}`, enabled, forced };
};

const commonOn = row('common', null, '');
const commonForced = row('common', null, '', 1, 1);
const commonOff = row('common', null, '', 0);
const projA = row('project', null, 'p_a');
const projAOff = row('project', null, 'p_a', 0);
const projB = row('project', null, 'p_b');
const mine = row('user', 'u_me', '');
const mineOff = row('user', 'u_me', '', 0);
const theirs = row('user', 'u_other', '');
const rows = [commonOn, commonForced, commonOff, projA, projAOff, projB, mine, mineOff, theirs];

const none = new Set<string>();
const paths = (r: PluginRowLike[]) => r.map((x) => x.path).sort();

// a personal session on project A: enabled common (incl. forced) + A's plugins + own personal
assert.deepEqual(
  selectPluginPaths(rows, none, 'user', 'u_me', 'p_a').sort(),
  paths([commonOn, commonForced, projA, mine]),
);
// nothing disabled, nothing from another project, nothing of another user's
for (const absent of [commonOff, projAOff, projB, mineOff, theirs]) {
  assert.ok(!selectPluginPaths(rows, none, 'user', 'u_me', 'p_a').includes(absent.path), `should not load ${absent.id}`);
}
// no project on the session → project plugins simply do not apply
assert.deepEqual(selectPluginPaths(rows, none, 'user', 'u_me', null).sort(), paths([commonOn, commonForced, mine]));
// a ROOM session has no personal layer, but still gets its project's plugins
assert.deepEqual(selectPluginPaths(rows, none, 'room', 'r_1', 'p_b').sort(), paths([commonOn, commonForced, projB]));

// a user who turned the optional common plugin off keeps the forced one
const off = new Set([commonOn.id, commonForced.id]);
assert.deepEqual(selectPluginPaths(rows, off, 'user', 'u_me', null).sort(), paths([commonForced, mine]));
// that preference belongs to a person, so it must not reach a room session
assert.ok(selectPluginPaths(rows, off, 'room', 'r_1', null).includes(commonOn.path));

// an unknown project id loads only what does not depend on a project
assert.deepEqual(selectPluginPaths(rows, none, 'user', 'u_me', 'p_gone').sort(), paths([commonOn, commonForced, mine]));
// and an empty table is not an error
assert.deepEqual(selectPluginPaths([], none, 'user', 'u_me', 'p_a'), []);

console.log('plugin scope: ok');
