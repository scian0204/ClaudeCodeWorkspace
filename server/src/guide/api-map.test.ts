// Runnable check (no framework): npx tsx server/src/guide/api-map.test.ts
//
// Two things the guide agent's safety rests on:
//   1. the allowlist actually refuses everything it does not name (this file's first half), and
//   2. `app.inject()` called from inside a plugin really re-enters the whole app WITH the caller's
//      cookie, so the target route's own auth runs (second half). If (2) ever stopped holding, the
//      agent would silently act with no session at all.
import assert from 'node:assert';
import Fastify from 'fastify';
import { findRoute, apiReference, API_ROUTES } from './api-map.js';

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
  ['POST', '/api/admin/restart'], ['POST', '/api/admin/cleanup'], ['POST', '/api/users'],
  ['POST', '/api/admin/image/pull'], ['GET', '/api/sessions/x/attachments/y'],
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
