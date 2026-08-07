// ── claude.ai 5-hour window primer ("5시간마다 임시 세션에서 아무 질의나 하여 카운트 시작") ──
// The claude.ai rolling window does not run on a wall clock: it opens on your FIRST billed message
// and closes 5 hours later. Idle time before that first message is simply lost — sit out an hour
// after a reset and you get 4 usable hours, not 5.
//
// So, for users who opt in, the server fires one tiny throwaway query the moment no window is open
// (right after a reset, or immediately on enable). That single call opens the window, and the next
// 5 hours are theirs to use whenever they actually sit down.
//
// This is deliberately NOT a chat session: no chat_sessions row, no messages, nothing in the
// sidebar. Just a short-lived CLI subprocess in the user's own project dir, billed to them (one
// `usage` row) so the cost stays visible.
//
// Claude-subscription only, exactly like auto-resume: the window is a claude.ai plan concept, so a
// user on an API key or a bedrock/vertex/custom provider is skipped.
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { cfg } from '../lib/config-registry.js';
import { paths, ensure } from '../lib/paths.js';
import { recordUsage } from '../usage/tracker.js';
import { resolveProvider } from '../auth/provider.js';
import { buildOptions, type SessionContext } from './config-layering.js';
import { io } from '../realtime/io.js';

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clear(userId: string) {
  const t = timers.get(userId);
  if (t) { clearTimeout(t); timers.delete(userId); }
}
function schedule(userId: string, delayMs: number) {
  clear(userId);
  // never sooner than a minute — a probe loop that spun would spawn a CLI subprocess each pass
  timers.set(userId, setTimeout(() => void tick(userId), Math.max(60_000, delayMs)));
}

// Short-lived CLI subprocess under the user's own auth, tools denied, hard timeout. `run` reads the
// stream: `probe` only wants the control-channel figures, `prime` wants the model to actually answer
// (that answer is what opens the window).
async function withQuery<T>(
  userId: string,
  prompt: string,
  run: (q: any) => Promise<T>,
): Promise<T | null> {
  const prov = resolveProvider(userId);
  // claude.ai subscription auth only. A browser sign-in qualifies too even though it sets no token
  // env — its credential lives in the user's HOME and the CLI picks it up from there.
  if (!prov.env.CLAUDE_CODE_OAUTH_TOKEN && prov.source !== 'login') return null;
  const cwd = paths.userProjects(userId);
  ensure(cwd);
  const ctx: SessionContext = {
    kind: 'user', ownerId: userId, cwd, model: cfg.str('windowPrimerModel'),
    permissionMode: 'default', plugins: [], authToken: '',
    providerEnv: prov.env, providerModel: prov.model,
  };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), cfg.int('windowPrimerTimeoutMs'));
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const options = buildOptions(ctx, {
      canUseTool: async () => ({ behavior: 'deny', message: 'window primer' }),
      abortController: abort,
    });
    return await run(query({ prompt, options }));
  } catch { return null; }
  finally {
    clearTimeout(timer);
    try { abort.abort(); } catch { /* noop */ }
  }
}

export interface WindowState { known: boolean; resetsAt: number | null }

// Is a 5h window currently open, and when does it close? A future `resets_at` means one is running
// (exhausted or not — either way we wait for it). No figures at all → `known: false`, retry later
// rather than guess, since priming on a bad guess would spend a real message for nothing.
export async function probeWindow(userId: string): Promise<WindowState> {
  const res = await withQuery(userId, 'ping', (q: any) => (
    typeof q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET === 'function'
      ? q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET() : Promise.resolve(null)
  ));
  if (!res || !(res as any).rate_limits_available) return { known: false, resetsAt: null };
  const raw = (res as any).rate_limits?.five_hour?.resets_at;
  const at = raw ? new Date(raw).getTime() : NaN;
  return { known: true, resetsAt: Number.isFinite(at) && at > Date.now() ? at : null };
}

// Open a window: one minimal billed message. Returns true if the model actually answered.
export async function primeWindow(userId: string): Promise<boolean> {
  const ok = await withQuery(userId, cfg.str('windowPrimerPrompt'), async (q: any) => {
    let answered = false;
    for await (const msg of q) {
      if (msg?.type === 'assistant') answered = true;
      else if (msg?.type === 'result') {
        recordUsage({
          userId, sessionId: null, roomId: null,
          inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0,
          costUsd: msg.total_cost_usd ?? 0,
        });
        break;
      }
    }
    return answered;
  });
  if (!ok) return false;
  const primedAt = Date.now();
  db.update(schema.users).set({ primedAt }).where(eq(schema.users.id, userId)).run();
  // tell the user's open tabs so My Page shows the new "last primed" without a reload
  try { io?.to(`user:${userId}`).emit('user:primed', { primedAt }); } catch { /* realtime optional */ }
  return true;
}

function enabledFor(userId: string): boolean {
  if (!cfg.bool('windowPrimerEnabled')) return false;
  const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  return u?.primeWindow === 1;
}

// One pass for a user: find out whether a window is open, and either wait for its reset or open one.
async function tick(userId: string): Promise<void> {
  if (!enabledFor(userId)) { clear(userId); return; }
  const w = await probeWindow(userId);
  if (!w.known) { schedule(userId, cfg.int('windowPrimerRetryMs')); return; } // no auth / probe failed
  if (w.resetsAt) { schedule(userId, w.resetsAt - Date.now() + cfg.int('windowPrimerGraceMs')); return; }

  const opened = await primeWindow(userId);
  if (!opened) { schedule(userId, cfg.int('windowPrimerRetryMs')); return; }
  // Re-probe so the next wake-up rides the real reset instant rather than a 5h guess. If the figures
  // haven't caught up with the message just sent, fall back to the retry cadence.
  const after = await probeWindow(userId);
  schedule(userId, after.resetsAt ? after.resetsAt - Date.now() + cfg.int('windowPrimerGraceMs') : cfg.int('windowPrimerRetryMs'));
}

// Arm / disarm one user after their My Page toggle.
export function syncPrimer(userId: string): void {
  if (!enabledFor(userId)) { clear(userId); return; }
  if (timers.has(userId)) return; // already scheduled — leave the pending wake-up alone
  schedule(userId, 60_000); // first pass shortly after enabling, not inside the request
}

// Boot: arm every opted-in user, staggered so N users don't spawn N CLI subprocesses at once.
export function startWindowPrimer(): void {
  db.select().from(schema.users).all()
    .filter((u) => u.primeWindow === 1)
    .forEach((u, i) => schedule(u.id, 60_000 + i * 15_000));
}
