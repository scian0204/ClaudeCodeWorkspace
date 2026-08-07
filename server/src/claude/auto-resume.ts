import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { cfg } from '../lib/config-registry.js';

// ── auto-resume on the claude.ai plan window reset ("5시간 토큰 초기화 시 자동 갱신") ──
// A turn that dies because the author's claude.ai plan window (5h rolling / weekly) is exhausted is
// NOT a transient 429 — retrying inside the turn is pointless (throttle.withRateLimitRetry only
// backs off on real 429/overloaded). Instead the prompt is parked in `pending_resumes` and
// re-enqueued once the window resets.
//
// Claude-only by construction: the window exists solely for a claude.ai subscription, i.e. the
// CLAUDE_CODE_OAUTH_TOKEN auth path. An API key or a bedrock/vertex/custom provider is pay-per-use
// and never eligible (see eligible()).

export type Attachment = { name: string; isImage: boolean };
export interface PendingResume {
  id: string; sessionId: string; author: { id: string; name: string };
  text: string; attachments: Attachment[]; includeChat: boolean;
  attempts: number; resumeAt: number; createdAt: number;
}

// Hooks pushed in by rooms/queue.ts at import time (queue → auto-resume, never the reverse) so this
// module stays cycle-free: session-manager imports it from inside its own catch path.
interface Hooks {
  enqueue: (sessionId: string, author: { id: string; name: string }, text: string, includeChat: boolean, attachments: Attachment[]) => void;
  emit: (sessionId: string, event: string, payload: any) => void;
}
let hooks: Hooks = { enqueue: () => {}, emit: () => {} };
export function setResumeHooks(h: Hooks) { hooks = h; }

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

// The CLI reports an exhausted plan window with one of these shapes; the classic form carries the
// reset instant as `…reached|<epoch>`. Deliberately narrow: a plain "rate limit"/"overloaded" is a
// transient 429 that withRateLimitRetry already owns, and parking it for hours would be wrong.
const LIMIT_RE = /usage limit reached|(?:5-hour|five-hour|weekly|opus) limit reached|limit reached\|\d{9,}/i;
export function isUsageLimitError(msg: string): boolean { return LIMIT_RE.test(msg || ''); }

// "Claude AI usage limit reached|1754200000" → epoch millis (the CLI emits seconds; millis tolerated).
export function resetAtFromError(msg: string): number | null {
  const m = /\|\s*(\d{9,13})\b/.exec(msg || '');
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? n : n * 1000;
}

// ── rows ──
const toPending = (r: typeof schema.pendingResumes.$inferSelect): PendingResume => ({
  id: r.id, sessionId: r.sessionId, author: { id: r.authorId, name: r.authorName },
  text: r.text, attachments: parseAtts(r.attachments), includeChat: r.includeChat === 1,
  attempts: r.attempts, resumeAt: r.resumeAt, createdAt: r.createdAt,
});
function parseAtts(raw: string): Attachment[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((a) => a && typeof a.name === 'string').map((a) => ({ name: a.name, isImage: !!a.isImage })) : [];
  } catch { return []; }
}

export function pendingForSession(sessionId: string): PendingResume[] {
  return db.select().from(schema.pendingResumes).where(eq(schema.pendingResumes.sessionId, sessionId)).all().map(toPending);
}
export function pendingForUser(userId: string): PendingResume[] {
  return db.select().from(schema.pendingResumes).where(eq(schema.pendingResumes.authorId, userId)).all().map(toPending);
}

// ── timers ──
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function disarm(id: string) { const t = timers.get(id); if (t) { clearTimeout(t); timers.delete(id); } }
function arm(row: PendingResume) {
  disarm(row.id);
  // resumeAt is at most ~5h out, well under the setTimeout 32-bit ceiling (~24.8 days).
  timers.set(row.id, setTimeout(() => fire(row.id), Math.max(0, row.resumeAt - Date.now())));
}

function drop(id: string) {
  disarm(id);
  db.delete(schema.pendingResumes).where(eq(schema.pendingResumes.id, id)).run();
}

function fire(id: string) {
  const row = db.select().from(schema.pendingResumes).where(eq(schema.pendingResumes.id, id)).get();
  disarm(id);
  if (!row) return; // cancelled while the timer was pending
  const p = toPending(row);
  db.delete(schema.pendingResumes).where(eq(schema.pendingResumes.id, id)).run();
  // remember how many auto-resumes this prompt already had, so a still-shut window can't loop
  attemptsSeen.set(attemptKey(p.sessionId, p.author.id), { n: p.attempts + 1, at: Date.now() });
  hooks.emit(p.sessionId, 'turn:resumeFired', { sessionId: p.sessionId, id: p.id, author: p.author });
  hooks.enqueue(p.sessionId, p.author, p.text, p.includeChat, p.attachments);
}

// ponytail: attempt counting is per (session, author) in memory, not per exact prompt — two prompts
// from the same author parked back-to-back share a counter (costs at most one retry). Persisted
// `attempts` carries the count into the next park; a restart resets it, which is the intended
// "fresh start" behaviour. Move the key to a prompt hash only if that ever misfires in practice.
const attemptsSeen = new Map<string, { n: number; at: number }>();
const attemptKey = (sessionId: string, authorId: string) => `${sessionId}|${authorId}`;
function takeAttempts(sessionId: string, authorId: string): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [k, v] of attemptsSeen) if (v.at < cutoff) attemptsSeen.delete(k);
  return attemptsSeen.get(attemptKey(sessionId, authorId))?.n ?? 0;
}

// ── eligibility ──
// Claude subscription auth only, feature on globally, user opted in, and never for the unattended
// review pipeline (it owns its own retry/watchdog and runs under an admin's auth).
// `subscriptionLogin` is the browser sign-in path: that credential lives in the user's HOME as the
// CLI's own .credentials.json, so the turn env carries no CLAUDE_CODE_OAUTH_TOKEN even though the
// auth IS a claude.ai subscription — gating on the env var alone would silently disable auto-resume
// for exactly the accounts that have a plan window.
export function eligible(userId: string, providerEnv: Record<string, string>, sessionKind: string, subscriptionLogin = false): boolean {
  if (!cfg.bool('autoResumeEnabled')) return false;
  if (sessionKind === 'review') return false;
  if (!providerEnv.CLAUDE_CODE_OAUTH_TOKEN && !subscriptionLogin) return false;
  const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  return u?.autoResume === 1;
}

export interface ParkParams {
  sessionId: string;
  author: { id: string; name: string };
  text: string;
  attachments?: Attachment[];
  includeChat?: boolean;
  errorMessage: string;
  // Best-effort real reset instant (probeUsage → rateLimits.fiveHour.resetsAt). Only consulted when
  // the error text didn't carry one.
  lookupResetAt?: () => Promise<number | null>;
}

// Park the failed turn and arm its timer. Returns the scheduled instant, or null when it wasn't
// parked (cap reached, or nothing to re-run).
export async function parkTurn(p: ParkParams): Promise<number | null> {
  if (!p.text.trim() && !(p.attachments || []).length) return null; // nothing to replay

  const attempts = takeAttempts(p.sessionId, p.author.id);
  if (attempts >= cfg.int('autoResumeMaxAttempts')) return null; // window still shut after N tries — stop
  if (pendingForUser(p.author.id).length >= cfg.int('autoResumeMaxPending')) return null;

  const fromError = resetAtFromError(p.errorMessage);
  const probed = fromError == null && p.lookupResetAt ? await p.lookupResetAt().catch(() => null) : null;
  // No usable instant anywhere → assume a full window from now (the pessimistic, never-early guess).
  const base = fromError ?? probed ?? Date.now() + FIVE_HOURS_MS;
  const resumeAt = Math.max(Date.now() + 1000, base + cfg.int('autoResumeGraceMs'));

  const row = {
    id: newId(), sessionId: p.sessionId, authorId: p.author.id, authorName: p.author.name,
    text: p.text, attachments: JSON.stringify(p.attachments || []),
    includeChat: p.includeChat ? 1 : 0, attempts, resumeAt, createdAt: Date.now(),
  };
  db.insert(schema.pendingResumes).values(row).run();
  arm(toPending(row));
  hooks.emit(p.sessionId, 'turn:resumeScheduled', {
    sessionId: p.sessionId, id: row.id, resumeAt, author: p.author, attempts,
  });
  return resumeAt;
}

// Cancel a parked turn. The socket handler owns the authorization check (author, session owner, or
// room interrupt right) before calling this.
export function cancelResume(id: string): PendingResume | null {
  const row = db.select().from(schema.pendingResumes).where(eq(schema.pendingResumes.id, id)).get();
  if (!row) return null;
  const p = toPending(row);
  drop(id);
  hooks.emit(p.sessionId, 'turn:resumeCancelled', { sessionId: p.sessionId, id });
  return p;
}

// Re-arm every persisted row at boot. Rows whose instant passed long ago (server was down for a
// while) are dropped rather than replayed — firing a day-old prompt unattended is worse than losing
// it. Anything only mildly overdue fires right away.
export function armPendingResumes(): void {
  const stale = Date.now() - cfg.int('autoResumeStaleMs');
  for (const row of db.select().from(schema.pendingResumes).all()) {
    if (row.resumeAt < stale) { drop(row.id); continue; }
    arm(toPending(row));
  }
}

// ── reasoning self-check (run once: AUTO_RESUME_SELFCHECK=1 npx tsx server/src/claude/auto-resume.ts) ──
if (process.env.AUTO_RESUME_SELFCHECK) {
  const assert = (cond: boolean, m: string) => { if (!cond) throw new Error('auto-resume check failed: ' + m); };
  assert(isUsageLimitError('Claude AI usage limit reached|1754200000'), 'classic CLI form detected');
  assert(isUsageLimitError('5-hour limit reached'), '5-hour form detected');
  assert(!isUsageLimitError('429 rate limit exceeded, retrying'), 'transient 429 is NOT a plan-window limit');
  assert(!isUsageLimitError('API Error: overloaded_error'), 'overloaded is NOT a plan-window limit');
  assert(resetAtFromError('usage limit reached|1754200000') === 1754200000000, 'epoch seconds → millis');
  assert(resetAtFromError('usage limit reached') === null, 'no epoch → null');
  // eslint-disable-next-line no-console
  console.log('auto-resume.ts self-check ok');
}
