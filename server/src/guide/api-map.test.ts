// Runnable check (no framework): npx tsx server/src/guide/api-map.test.ts
//
// Two things the guide agent's safety rests on:
//   1. the allowlist actually refuses everything it does not name (this file's first half), and
//   2. `app.inject()` called from inside a plugin really re-enters the whole app WITH the caller's
//      cookie, so the target route's own auth runs (second half). If (2) ever stopped holding, the
//      agent would silently act with no session at all.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { findRoute, apiReference, API_ROUTES } from './api-map.js';
import { UI_ACTIONS, uiActionReference } from './ui-actions.js';

// ── allowlist ──
assert.ok(findRoute('GET', '/api/sessions'), 'listed route matches');
assert.ok(findRoute('get', '/api/sessions'), 'method is case-insensitive');
assert.ok(findRoute('GET', '/api/sessions/abc123'), ':id matches one segment');
assert.ok(findRoute('GET', '/api/search?q=auth&sort=new'), 'query string is stripped before matching');
assert.ok(!findRoute('GET', '/api/sessions/abc/messages'), ':id does not span a slash');
assert.ok(!findRoute('POST', '/api/sessions/abc123'), 'method must match too');

// destructive + secret-bearing routes must never be reachable, whatever the model asks for
for (const [m, p] of [
  ['DELETE', '/api/sessions/x'], ['DELETE', '/api/projects/x'], ['DELETE', '/api/plugins/x'],
  ['PUT', '/api/auth/me/claude-token'], ['GET', '/api/git-credentials'], ['POST', '/api/git-credentials'],
  ['PUT', '/api/admin/claude-token'], ['PUT', '/api/auth/me/provider'], ['GET', '/api/admin/provider'],
  ['GET', '/api/admin/ldap'], ['PUT', '/api/admin/ldap'], ['POST', '/api/admin/ldap/import'],
  ['GET', '/api/admin/oidc'], ['PUT', '/api/admin/oidc'],
  ['POST', '/api/admin/restart'], ['POST', '/api/admin/cleanup'], ['POST', '/api/users'],
  ['POST', '/api/admin/image/pull'], ['GET', '/api/sessions/x/attachments/y'],
  // one-way doors outside this server + the infra verbs — see the header comment in api-map.ts
  ['POST', '/api/review/sessions/x/merge'], ['POST', '/api/review/sessions/x/approve'],
  ['POST', '/api/review/repos/x/webhook'], ['POST', '/api/projects/x/git/publish'],
  ['POST', '/api/rooms/x/transfer'], ['GET', '/api/admin/backup'], ['POST', '/api/admin/restore/apply'],
  ['POST', '/api/admin/update/apply'], ['POST', '/api/sessions/x/messages/y/edit'],
] as const) {
  assert.ok(!findRoute(m, p), `${m} ${p} must NOT be allowlisted`);
}
assert.ok(!API_ROUTES.some((r) => (r.m as string) === 'DELETE'), 'the table contains no DELETE at all');

// a path that merely looks like an allowlisted one must not sneak through
assert.ok(!findRoute('GET', '/api/config/../admin/provider'), 'traversal-looking path is not a match');

// ── prompt projection: a member is never even told the admin routes exist ──
const memberRef = apiReference(false);
const adminRef = apiReference(true);
assert.ok(adminRef.includes('/api/admin/config'), 'admin sees the admin routes');
assert.ok(!memberRef.includes('/api/admin/config'), 'member does not');
assert.ok(memberRef.includes('/api/sessions'), 'member still sees the ordinary ones');
assert.ok(adminRef.split('\n').length > memberRef.split('\n').length);

// ── ui actions: the browser really handles every action the agent is offered ──
// The two tables live in different workspaces, so nothing but this check stops the prompt from
// advertising an action that applyGuideAction() silently drops.
const storeSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../web/src/lib/store.ts'), 'utf8');
const handled = new Set(Array.from(storeSrc.matchAll(/case '([a-zA-Z]+)':/g), (m) => m[1]));
for (const a of UI_ACTIONS) {
  assert.ok(handled.has(a.action), `ui action '${a.action}' has no case in web/src/lib/store.ts applyGuideAction`);
}
assert.ok(!uiActionReference(false).includes('openAdmin'), 'a member is not told about the admin action');

// ── app.inject() from a child plugin reaches a sibling plugin's route, cookie intact ──
const app = Fastify({ logger: false });
await app.register(async (a) => {
  a.get('/api/whoami', async (req) => ({ cookie: req.headers.cookie ?? null }));
});
let seen: any = null;
await app.register(async (a) => {
  // `a` is the encapsulated plugin instance — exactly what guideRoutes() hands the agent.
  a.post('/api/probe', async () => {
    const res = await a.inject({ method: 'GET', url: '/api/whoami', headers: { cookie: 'ccw_sid=tok123' } });
    seen = JSON.parse(res.body);
    return { status: res.statusCode };
  });
});
const probe = await app.inject({ method: 'POST', url: '/api/probe' });
assert.equal(probe.statusCode, 200);
assert.equal(JSON.parse(probe.body).status, 200, 'the sibling route was actually reached');
assert.equal(seen?.cookie, 'ccw_sid=tok123', 'the replayed cookie arrives at the target route');
await app.close();

// eslint-disable-next-line no-console
console.log('guide/api-map.test.ts ok');
