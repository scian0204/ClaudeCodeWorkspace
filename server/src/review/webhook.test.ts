// Runnable check (no framework): npx tsx server/src/review/webhook.test.ts
import assert from 'node:assert';
import crypto from 'node:crypto';
import { newWebhookSecret, verifyHook, isPrEvent } from './webhook.js';

const secret = 'test-secret-1234';
const raw = '{"action":"synchronize","number":7}';
const sign = (s: string, body: string) => `sha256=${crypto.createHmac('sha256', s).update(body, 'utf8').digest('hex')}`;

// GitHub: HMAC over the exact body bytes
assert.equal(verifyHook(secret, raw, { 'x-hub-signature-256': sign(secret, raw) }), true);
assert.equal(verifyHook(secret, raw, { 'x-hub-signature-256': sign('other-secret', raw) }), false);
// a tampered body must not verify under the right secret
assert.equal(verifyHook(secret, `${raw} `, { 'x-hub-signature-256': sign(secret, raw) }), false);
// a signature header present but wrong length (truncated) → reject, never throw
assert.equal(verifyHook(secret, raw, { 'x-hub-signature-256': 'sha256=abc' }), false);
// signature header wins over a valid ?token= — a signed delivery must be verified as signed
assert.equal(verifyHook(secret, raw, { 'x-hub-signature-256': 'sha256=abc' }, secret), false);

// GitLab: secret verbatim in the header
assert.equal(verifyHook(secret, raw, { 'x-gitlab-token': secret }), true);
assert.equal(verifyHook(secret, raw, { 'x-gitlab-token': 'nope' }), false);

// Bitbucket (no secret field of its own): ?token=
assert.equal(verifyHook(secret, raw, { 'x-event-key': 'pullrequest:created' }, secret), true);
assert.equal(verifyHook(secret, raw, { 'x-event-key': 'pullrequest:created' }, 'nope'), false);
// nothing supplied at all → reject
assert.equal(verifyHook(secret, raw, {}), false);
// repo with webhooks disabled (empty secret) never authenticates, even with a matching empty token
assert.equal(verifyHook('', raw, {}, ''), false);

// event filter: PR events poll, noise doesn't, unknown provider falls open
assert.equal(isPrEvent({ 'x-github-event': 'pull_request' }), true);
assert.equal(isPrEvent({ 'x-github-event': 'ping' }), false);
assert.equal(isPrEvent({ 'x-github-event': 'issue_comment' }), false);
assert.equal(isPrEvent({ 'x-gitlab-event': 'Merge Request Hook' }), true);
assert.equal(isPrEvent({ 'x-gitlab-event': 'Push Hook' }), false);
assert.equal(isPrEvent({ 'x-event-key': 'pullrequest:updated' }), true);
assert.equal(isPrEvent({ 'x-event-key': 'repo:push' }), false);
assert.equal(isPrEvent({}), true);

// generated secrets are URL-safe (they get pasted into a ?token= query) and distinct
const a = newWebhookSecret(), b = newWebhookSecret();
assert.notEqual(a, b);
assert.match(a, /^[A-Za-z0-9_-]{30,}$/);

console.log('webhook: ok');
