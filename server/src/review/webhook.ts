// Inbound provider webhooks. A PR event on a watched repo triggers that repo's poll immediately
// instead of waiting for the next interval tick (so a deployment can run with REVIEW_POLL_MS=0).
// One endpoint per repo, authenticated by a per-repo secret. Three shapes, because the providers
// disagree: GitHub signs the body (X-Hub-Signature-256), GitLab sends the secret verbatim in a
// header (X-Gitlab-Token), Bitbucket has no secret field at all → the secret rides in ?token=.

import crypto from 'node:crypto';

export function newWebhookSecret(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false; // length isn't the secret; timingSafeEqual throws on mismatch
  return crypto.timingSafeEqual(ab, bb);
}

// Authenticate one delivery. `raw` must be the exact request bytes — GitHub's HMAC is over the body
// as sent, so a re-serialized JSON object would not match. Anything unrecognized/unsigned fails.
export function verifyHook(secret: string, raw: string, headers: Record<string, unknown>, token?: string): boolean {
  if (!secret) return false;
  const sig = String(headers['x-hub-signature-256'] || '');
  if (sig) return safeEqual(sig, `sha256=${crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`);
  const gitlab = String(headers['x-gitlab-token'] || '');
  if (gitlab) return safeEqual(gitlab, secret);
  if (token) return safeEqual(token, secret);
  return false;
}

// Is this delivery worth a poll? Comment/star/branch-push noise is answered 200-and-ignored so a
// chatty repo doesn't re-fetch the clone on every event. An unrecognized provider polls (fail open:
// a wasted fetch beats a missed PR).
export function isPrEvent(headers: Record<string, unknown>): boolean {
  const gh = String(headers['x-github-event'] || '');
  if (gh) return gh === 'pull_request'; // 'ping' (webhook creation) verifies + returns ok without polling
  const gl = String(headers['x-gitlab-event'] || '');
  if (gl) return gl.toLowerCase().includes('merge request'); // 'Merge Request Hook' — also fires on head push
  const bb = String(headers['x-event-key'] || '');
  if (bb) return bb.startsWith('pullrequest:');
  return true;
}
