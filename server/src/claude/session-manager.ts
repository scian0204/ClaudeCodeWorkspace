import fs from 'node:fs';
import path from 'node:path';
import { eq, and, desc, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { paths, ensure } from '../lib/paths.js';
import { isBareBasename } from '../lib/attachments.js';
import { allowBypass } from '../lib/settings.js';
import { turnLimiter, withRateLimitRetry } from './throttle.js';
import { buildOptions, clampMode, rootsFor, type SessionContext, type PermMode } from './config-layering.js';
import { makeCanUseTool, makeAutoAllow } from './permissions.js';
import { resolvePluginPaths } from '../plugins/manager.js';
import { recordUsage, recordSkillUse, turnSkillKeys } from '../usage/tracker.js';
import { resolveProvider } from '../auth/provider.js';
import { originHost } from '../lib/git-ops.js';
import { resolveGitCred, gitIdentity, identityEnv, askpassEnv } from '../auth/git-cred.js';
import { getReviewByChat, ensureWorktree } from '../review/manager.js';
import { sandboxAvailable, ensureSandbox, removeSandbox, sandboxMcpServer } from '../review/sandbox.js';
import { cfg } from '../lib/config-registry.js';
import { maybeAutoTitle } from './auto-title.js';
import { isUsageLimitError, eligible as autoResumeEligible, parkTurn } from './auto-resume.js';

type Emit = (event: string, payload: any) => void;

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean };

interface ActiveTurn {
  abort: AbortController; blocks: Block[]; author: { id: string; name: string };
  startedAt: number; // when this turn went live (admin process panel: elapsed time)
  query?: { interrupt: () => Promise<unknown> }; // live SDK handle for immediate turn-stop
}
const active = new Map<string, ActiveTurn>();

export function isTurnActive(sessionId: string) { return active.has(sessionId); }
// Live snapshot of every running turn (admin "activity/processes" panel).
export function listActiveTurns(): { sessionId: string; author: { id: string; name: string }; startedAt: number }[] {
  return [...active.entries()].map(([sessionId, t]) => ({ sessionId, author: t.author, startedAt: t.startedAt }));
}
// Snapshot of the in-flight turn so a client joining mid-turn can render progress it missed.
export function liveTurn(sessionId: string): { blocks: Block[]; author: { id: string; name: string } } | null {
  const t = active.get(sessionId);
  return t ? { blocks: t.blocks, author: t.author } : null;
}
export function interruptTurn(sessionId: string): boolean {
  const t = active.get(sessionId);
  if (!t) return false;
  // abort() alone only closes the CLI's stdin and waits ~2s for the graceful path, so the model
  // keeps streaming and "stop" feels dead. Fire the SDK's control-channel interrupt first to stop
  // the current turn immediately; abort() below is the guaranteed subprocess-teardown fallback.
  try { void t.query?.interrupt().catch(() => { /* fall back to abort */ }); } catch { /* noop */ }
  t.abort.abort();
  return true;
}

function getSession(id: string) {
  return db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
}
function getProject(id: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}
function getWikiTopic(id: string) {
  return db.select().from(schema.wikiTopics).where(eq(schema.wikiTopics.id, id)).get();
}

async function cwdFor(s: NonNullable<ReturnType<typeof getSession>>): Promise<string> {
  // review session runs inside its PR's git worktree (created lazily); local merge happens there
  if (s.kind === 'review') {
    const rv = getReviewByChat(s.id);
    if (rv) return await ensureWorktree(rv);
  }
  // wiki thread runs inside its topic's knowledge dir so Claude reads the .md base + CLAUDE.md
  if (s.wikiTopicId) {
    const t = getWikiTopic(s.wikiTopicId);
    if (t) { ensure(t.path); return t.path; }
  }
  if (s.projectId) {
    const p = getProject(s.projectId);
    if (p) { ensure(p.path); return p.path; }
  }
  const dir = s.kind === 'room' ? paths.roomProjects(s.roomId!) : paths.userProjects(s.ownerId);
  ensure(dir);
  return dir;
}

// Git env for a turn: author identity (always) + push credentials for the workspace's origin host
// (if one is stored). Lets Claude's own `git commit`/`git push` be attributed and authenticated.
async function buildGitEnv(cwd: string, userId: string): Promise<Record<string, string> | undefined> {
  try {
    const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!user) return undefined;
    const host = await originHost(cwd);
    const cred = host ? resolveGitCred(userId, host) : null;
    const ident = gitIdentity({ username: user.username, displayName: user.displayName }, cred);
    return { ...identityEnv(ident), ...(cred ? askpassEnv(cred) : {}) };
  } catch { return undefined; }
}

function saveMessage(row: {
  sessionId: string; role: string; authorId?: string | null; authorName?: string | null; content: any; chat?: boolean;
}) {
  const m = {
    id: newId(), sessionId: row.sessionId, role: row.role,
    authorId: row.authorId ?? null, authorName: row.authorName ?? null,
    content: JSON.stringify(row.content), chat: row.chat ? 1 : 0, createdAt: Date.now(),
  };
  db.insert(schema.messages).values(m).run();
  return { ...m, content: row.content };
}

// Room team chat: persist + broadcast a member message WITHOUT running a Claude turn.
export function postChat(sessionId: string, author: { id: string; name: string }, text: string, emit: Emit) {
  const msg = saveMessage({ sessionId, role: 'user', authorId: author.id, authorName: author.name, content: { text }, chat: true });
  db.update(schema.chatSessions).set({ updatedAt: Date.now() }).where(eq(schema.chatSessions.id, sessionId)).run();
  emit('message', { sessionId, message: publicMessage(msg) });
}

// Probe the real slash commands (built-in + plugin + skill) the CLI exposes for this session,
// with their descriptions and argument hints. `query.supportedCommands()` resolves right after
// the CLI initializes; we then abort so no model tokens are spent. Cached by session +
// enabled-plugin signature so toggling plugins/skills refreshes the list without a stale hit.
export interface CmdInfo { name: string; description: string; argumentHint: string }
const cmdCache = new Map<string, CmdInfo[]>();
export async function probeCommands(chatSessionId: string, requesterId?: string | null): Promise<CmdInfo[]> {
  const s = getSession(chatSessionId);
  if (!s) return [];
  const kind: 'user' | 'room' = s.kind === 'room' ? 'room' : 'user';
  const ownerId = kind === 'room' ? s.roomId! : s.ownerId;
  // Probe with the viewer's auth (or the owner's for a private session); none => nothing to probe.
  const prov = resolveProvider(requesterId ?? (kind === 'user' ? ownerId : null));
  if (prov.source === 'none') return [];
  const plugins = resolvePluginPaths(kind, ownerId);
  const key = `${chatSessionId}|${plugins.join(',')}`;
  const hit = cmdCache.get(key);
  if (hit) return hit;
  const ctx: SessionContext = {
    kind, ownerId, cwd: await cwdFor(s), model: s.model || cfg.str('defaultModel'),
    effort: (s.effort || cfg.str('defaultEffort')) as SessionContext['effort'],
    permissionMode: clampMode((s.permissionMode as PermMode) || 'default', allowBypass()), plugins,
    authToken: '', providerEnv: prov.env, providerModel: prov.model,
  };
  const abort = new AbortController();
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const options = buildOptions(ctx, { canUseTool: async () => ({ behavior: 'deny', message: 'probe' }), abortController: abort });
    const q = query({ prompt: 'ping', options });
    const cmds = await (q as any).supportedCommands();
    const res: CmdInfo[] = (cmds || []).map((c: any) => ({
      name: String(c.name || '').replace(/^\//, ''),
      description: String(c.description || ''),
      argumentHint: String(c.argumentHint || ''),
    })).filter((c: CmdInfo) => c.name);
    cmdCache.set(key, res);
    return res;
  } catch { /* probe failed — return empty, don't cache */ }
  finally { try { abort.abort(); } catch { /* noop */ } }
  return [];
}

// ── usage probe: context-window breakdown + claude.ai plan rate limits (5h / weekly / per-model) ──
// Same short-lived-query trick as probeCommands: resume the session so getContextUsage reflects the
// real transcript, ask the CLI's control channel for both figures, then abort (no model tokens spent).
// ponytail: spawns a CLI subprocess per probe — the TTL cache below keeps popover reopens free;
// upgrade to a long-lived query per session only if this ever gets hot.
type Win = { utilization: number | null; resetsAt: string | null };
type ModelWin = Win & { displayName: string };
export interface UsageInfo {
  context: { totalTokens: number; maxTokens: number; percentage: number; model: string } | null;
  rateLimitsAvailable: boolean;
  subscriptionType: string | null;
  rateLimits: { fiveHour: Win | null; sevenDay: Win | null; modelScoped: ModelWin[] } | null;
}
const EMPTY_USAGE: UsageInfo = { context: null, rateLimitsAvailable: false, subscriptionType: null, rateLimits: null };
const usageCache = new Map<string, { at: number; data: UsageInfo }>();
const win = (w: any): Win | null => (w ? { utilization: w.utilization ?? null, resetsAt: w.resets_at ?? null } : null);

export async function probeUsage(chatSessionId: string, requesterId?: string | null): Promise<UsageInfo> {
  const s = getSession(chatSessionId);
  if (!s) return EMPTY_USAGE;
  const kind: 'user' | 'room' = s.kind === 'room' ? 'room' : 'user';
  const ownerId = kind === 'room' ? s.roomId! : s.ownerId;
  // Rate limits + subscription are account-specific to whoever probes (their own auth wins in
  // resolveProvider), so the cache MUST be keyed per requester — keying by session alone would
  // serve one member's claude.ai plan usage to another viewer of the same room/review/session.
  const authId = requesterId ?? (kind === 'user' ? ownerId : null);
  const prov = resolveProvider(authId);
  if (prov.source === 'none') return EMPTY_USAGE; // mock / no auth → nothing to report

  const cacheKey = `${chatSessionId}|${authId ?? 'shared'}`;
  const hit = usageCache.get(cacheKey);
  if (hit && Date.now() - hit.at < cfg.int('usageProbeTtlMs')) return hit.data;

  const ctx: SessionContext = {
    kind, ownerId, cwd: await cwdFor(s), model: s.model || cfg.str('defaultModel'),
    effort: (s.effort || cfg.str('defaultEffort')) as SessionContext['effort'],
    permissionMode: clampMode((s.permissionMode as PermMode) || 'default', allowBypass()),
    plugins: resolvePluginPaths(kind, ownerId), authToken: '', providerEnv: prov.env, providerModel: prov.model,
  };
  const abort = new AbortController();
  const withTimeout = <T,>(p: Promise<T>): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), cfg.int('usageProbeTimeoutMs')))]);
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const options = buildOptions(ctx, {
      canUseTool: async () => ({ behavior: 'deny', message: 'probe' }),
      resume: s.claudeSessionId, abortController: abort,
    });
    const q: any = query({ prompt: 'ping', options });
    const [cu, us] = await Promise.all([
      typeof q.getContextUsage === 'function' ? withTimeout(q.getContextUsage()) : Promise.resolve(null),
      typeof q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET === 'function'
        ? withTimeout(q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()) : Promise.resolve(null),
    ]);
    const rl = (us as any)?.rate_limits;
    const data: UsageInfo = {
      context: cu ? { totalTokens: (cu as any).totalTokens, maxTokens: (cu as any).maxTokens, percentage: (cu as any).percentage, model: (cu as any).model } : null,
      rateLimitsAvailable: !!(us as any)?.rate_limits_available,
      subscriptionType: (us as any)?.subscription_type ?? null,
      rateLimits: rl ? {
        fiveHour: win(rl.five_hour),
        sevenDay: win(rl.seven_day),
        modelScoped: (rl.model_scoped || []).map((m: any) => ({ displayName: m.display_name, utilization: m.utilization ?? null, resetsAt: m.resets_at ?? null })),
      } : null,
    };
    usageCache.set(cacheKey, { at: Date.now(), data });
    return data;
  } catch { return EMPTY_USAGE; }
  finally { try { abort.abort(); } catch { /* noop */ } }
}

// When does the exhausted plan window reopen? Asks the CLI for the live figures and takes the LATEST
// reset among the windows that are actually spent — if both the 5h and the weekly window are full,
// waiting only for the 5h one would just fail again. Falls back to the 5h window, then null.
async function probeResetAt(chatSessionId: string, requesterId: string): Promise<number | null> {
  const rl = (await probeUsage(chatSessionId, requesterId)).rateLimits;
  if (!rl) return null;
  const ms = (w: Win | null) => { const t = w?.resetsAt ? new Date(w.resetsAt).getTime() : NaN; return Number.isFinite(t) ? t : null; };
  const spent = [rl.fiveHour, rl.sevenDay, ...rl.modelScoped]
    .filter((w): w is Win => !!w && (w.utilization ?? 0) >= 99)
    .map(ms).filter((t): t is number => t != null);
  return spent.length ? Math.max(...spent) : ms(rl.fiveHour);
}

export interface RunTurnParams {
  chatSessionId: string;
  author: { id: string; name: string };
  text: string;
  emit: Emit;
  includeChat?: boolean; // room: prepend team chat accrued since the last Claude turn as context
  onDone?: (finalText: string) => void; // review auto-pipeline: capture the verdict after the turn
  attachments?: { name: string; isImage: boolean }[]; // prompt attachments (files / pasted screenshots)
}

export async function runTurn(p: RunTurnParams): Promise<void> {
  const s = getSession(p.chatSessionId);
  if (!s) throw new Error('session not found');

  const kind: 'user' | 'room' = s.kind === 'room' ? 'room' : 'user';
  const ownerId = kind === 'room' ? s.roomId! : s.ownerId;
  const cwd = await cwdFor(s);
  const mode = clampMode((s.permissionMode as PermMode) || 'default', allowBypass());
  // Each turn runs under its author's auth (personal: owner; room: whoever sent this message).
  // resolveProvider layers an optional LLM-provider override on top of the default Claude-token path.
  const prov = resolveProvider(p.author.id);
  // SECURITY: review turns run unattended and build/run PR-controlled code with Bash auto-allowed,
  // so never hand them the merge-capable git PAT — it would be readable from the child env by any
  // build/test script the PR ships. Review never pushes (the remote merge uses the host API), and
  // the local merge already ran, so no git credential is needed here.
  const gitEnv = s.kind === 'review' ? undefined : await buildGitEnv(cwd, p.author.id);

  // Review turns: isolate build/run in a locked-down sandbox container and deny the host shell, so
  // untrusted PR build/test code can't touch the app container (which holds the Docker socket).
  // If Docker isn't available, fall back to host exec (auto-allowed) — the trusted-team ceiling.
  let mcpServers: Record<string, any> | undefined;
  let disallowedTools: string[] | undefined;
  let sandboxCleanup: (() => Promise<void>) | undefined;
  if (s.kind === 'review' && sandboxAvailable()) {
    const rv = getReviewByChat(s.id);
    if (rv) {
      try {
        const cname = await ensureSandbox(rv.repoId, rv.prNumber, cwd);
        mcpServers = { sandbox: await sandboxMcpServer(cname, cwd, cfg.int('reviewSandboxExecTimeoutMs')) };
        disallowedTools = ['Bash'];
        sandboxCleanup = () => removeSandbox(rv.repoId, rv.prNumber);
      } catch { /* sandbox failed to start → host exec fallback */ }
    }
  }

  const ctx: SessionContext = {
    kind, ownerId, cwd, model: s.model || cfg.str('defaultModel'),
    effort: (s.effort || cfg.str('defaultEffort')) as SessionContext['effort'],
    permissionMode: mode, plugins: resolvePluginPaths(kind, ownerId),
    authToken: '', providerEnv: prov.env, providerModel: prov.model, gitEnv, mcpServers, disallowedTools,
  };

  // room + "include chat": collect team-chat accrued since Claude last saw a message,
  // so it can catch up on the discussion. Boundary = last chat=0 user message (already in context).
  let contextChat: { name: string; text: string }[] = [];
  if (kind === 'room' && p.includeChat) {
    const lastSeen = db.select({ c: schema.messages.createdAt }).from(schema.messages)
      .where(and(eq(schema.messages.sessionId, s.id), eq(schema.messages.role, 'user'), eq(schema.messages.chat, 0)))
      .orderBy(desc(schema.messages.createdAt)).limit(1).get();
    const boundary = lastSeen?.c ?? 0;
    const rows = db.select().from(schema.messages)
      .where(and(eq(schema.messages.sessionId, s.id), eq(schema.messages.chat, 1), gte(schema.messages.createdAt, boundary)))
      .orderBy(schema.messages.createdAt).all();
    contextChat = rows.map((r) => ({ name: r.authorName || '?', text: (JSON.parse(r.content) as any).text || '' }));
  }

  // resolve prompt attachments → absolute paths under the session's attachment dir. Re-validate each
  // name is a bare basename that actually exists there (ignore anything that doesn't); the dir sits
  // inside an allowed root so the agent can Read these paths (images render visually via Read).
  const attachDir = paths.attachments(kind, ownerId, s.id);
  const attachments = (p.attachments || [])
    .filter((a) => a && isBareBasename(a.name) && fs.existsSync(path.join(attachDir, a.name)))
    .map((a) => ({ name: a.name, isImage: !!a.isImage, abs: path.join(attachDir, a.name) }));

  // persist + broadcast the human message (speaker prefix for multi-party rooms; attachment metadata
  // rides in content so the transcript can render chips/thumbnails)
  const userMsg = saveMessage({
    sessionId: s.id, role: 'user', authorId: p.author.id, authorName: p.author.name,
    content: attachments.length
      ? { text: p.text, attachments: attachments.map((a) => ({ name: a.name, isImage: a.isImage })) }
      : { text: p.text },
  });
  db.update(schema.chatSessions).set({ updatedAt: Date.now() }).where(eq(schema.chatSessions.id, s.id)).run();
  p.emit('message', { sessionId: s.id, message: publicMessage(userMsg) });

  // global shared-key throttle
  if (turnLimiter.inUse >= turnLimiter.max) p.emit('turn:congested', { sessionId: s.id });
  const release = await turnLimiter.acquire();

  const abort = new AbortController();
  const blocks: Block[] = [];
  const turn: ActiveTurn = { abort, blocks, author: p.author, startedAt: Date.now() }; // blocks kept live so join can replay progress
  active.set(s.id, turn);
  p.emit('turn:start', { sessionId: s.id, author: p.author });

  let prompt = kind === 'room' ? `[${p.author.name}]: ${p.text}` : p.text;
  if (contextChat.length) {
    const convo = contextChat.map((c) => `[${c.name}]: ${c.text}`).join('\n');
    prompt = `[\uc774\uc804 \ub300\ud654]\n${convo}\n\n[${p.author.name}]: ${p.text}`;
  }
  // prepend absolute attachment paths so the agent Reads the uploaded files / pasted screenshots.
  // (Composed into the REAL prompt only; the mock path uses p.text and doesn't run a real agent.)
  if (attachments.length) {
    const list = attachments.map((a) => `- ${a.abs}${a.isImage ? ' (\uc774\ubbf8\uc9c0)' : ''}`).join('\n');
    prompt = `[\ucca8\ubd80 \ud30c\uc77c]\n${list}\n\n${prompt}`;
  }
  const roots = rootsFor(ctx);
  // review sessions run the pipeline unattended → auto-allow tools (class-1 fence still applies)
  const canUseTool = s.kind === 'review'
    ? makeAutoAllow(roots)
    : makeCanUseTool({ sessionId: s.id, roots, mode, emit: p.emit, signal: abort.signal });

  // The CLI session id is what lets the NEXT turn resume this conversation, so persist it the moment
  // the CLI reports it instead of only after a clean finish. A turn that fails, gets interrupted, or
  // dies with the container (rebuild!) still wrote a real transcript to disk — dropping its id there
  // silently restarts Claude with an empty context on the next message, which is invisible to the user
  // because the transcript the UI renders comes from our own DB.
  let newClaudeSessionId: string | null = s.claudeSessionId ?? null;
  const rememberSessionId = (id: string) => {
    if (!id || id === newClaudeSessionId) return;
    newClaudeSessionId = id;
    db.update(schema.chatSessions).set({ claudeSessionId: id, updatedAt: Date.now() })
      .where(eq(schema.chatSessions.id, s.id)).run();
  };
  let inTok = 0, outTok = 0, cost = 0;

  try {
    if (prov.source === 'none') {
      await runMock({ ctx, prompt: p.text, canUseTool, emit: p.emit, sessionId: s.id, blocks, signal: abort.signal });
      inTok = 12; outTok = 40; cost = 0;
    } else {
      const runOnce = (resume: string | null) => withRateLimitRetry(
        () => runReal({ ctx, prompt, canUseTool, emit: p.emit, sessionId: s.id, blocks, resume, abort,
          onQuery: (q) => { turn.query = q; }, onSessionId: rememberSessionId }),
        (ms) => p.emit('turn:congested', { sessionId: s.id, backoffMs: ms }),
        abort.signal, // a stop during rate-limit backoff must break the sleep, not wait it out
      );
      let res;
      try {
        res = await runOnce(s.claudeSessionId);
      } catch (e: any) {
        // Stale resume id (transcript missing for this cwd, e.g. after a project switch)
        // → drop the resume and start a fresh conversation once instead of failing the turn.
        if (s.claudeSessionId && !abort.signal.aborted && /No conversation found/i.test(String(e?.message || e))) {
          blocks.length = 0;
          res = await runOnce(null);
        } else throw e;
      }
      if (res.claudeSessionId) rememberSessionId(res.claudeSessionId); // no-op unless the stream never reported it
      inTok = res.inputTokens; outTok = res.outputTokens; cost = res.costUsd;
    }

    const asstMsg = saveMessage({ sessionId: s.id, role: 'assistant', authorName: 'Claude', content: { blocks } });
    recordUsage({ // (the resume id is already stored — rememberSessionId wrote it mid-stream)
      userId: p.author.id, sessionId: s.id, roomId: kind === 'room' ? ownerId : null,
      inputTokens: inTok, outputTokens: outTok, costUsd: cost,
    });
    p.emit('turn:end', {
      sessionId: s.id, message: publicMessage(asstMsg),
      usage: { inputTokens: inTok, outputTokens: outTok, costUsd: cost },
    });
    // a still-unnamed private chat gets named after its topic (best-effort, never blocks the turn)
    void maybeAutoTitle({
      sessionId: s.id, cwd, hasAuth: prov.source !== 'none', emit: p.emit,
      providerEnv: prov.env, providerModel: prov.model,
    }).catch(() => { /* titling is cosmetic — never surface it as a turn failure */ });
  } catch (e: any) {
    const aborted = abort.signal.aborted;
    const errMsg = aborted ? 'interrupted' : String(e?.message || e);
    // The author's claude.ai plan window is exhausted (not a transient 429 — withRateLimitRetry
    // already handled those). If they opted in, park the prompt and re-run it when the window
    // resets instead of losing it. Never blocks the failure path: a park error still reports.
    let resumeAt: number | null = null;
    if (!aborted && isUsageLimitError(errMsg) && autoResumeEligible(p.author.id, prov.env, s.kind)) {
      resumeAt = await parkTurn({
        sessionId: s.id, author: p.author, text: p.text,
        attachments: attachments.map((a) => ({ name: a.name, isImage: a.isImage })),
        includeChat: p.includeChat, errorMessage: errMsg,
        lookupResetAt: () => probeResetAt(s.id, p.author.id),
      }).catch(() => null);
    }
    p.emit('turn:error', { sessionId: s.id, aborted, error: errMsg, ...(resumeAt ? { resumeAt } : {}) });
    if (blocks.length) saveMessage({ sessionId: s.id, role: 'assistant', authorName: 'Claude', content: { blocks, interrupted: aborted } });
  } finally {
    active.delete(s.id);
    release();
    // Per-user skill counters. In `finally` on purpose: a skill that ran is a skill that ran, even
    // if the turn was later interrupted or failed. Never let a counter write break the turn result.
    if (cfg.bool('skillUsageEnabled')) {
      try { for (const k of turnSkillKeys(p.text, blocks)) recordSkillUse(p.author.id, k); }
      catch { /* counters are cosmetic */ }
    }
    // Await sandbox teardown BEFORE onDone. onDone can fire a review re-run (watchdog retry / new push)
    // whose git reset --hard + merge rewrite the PR worktree; removeSandbox force-removes the container,
    // which is what actually kills any build still writing into that same bind-mounted worktree. Firing
    // the re-run before the container is gone would race the dying build against the git ops.
    if (sandboxCleanup) { try { await sandboxCleanup(); } catch { /* best-effort */ } }
    if (p.onDone) {
      const finalText = blocks.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
      try { p.onDone(finalText); } catch { /* noop */ }
    }
  }
}

function publicMessage(m: any) {
  return {
    id: m.id, sessionId: m.sessionId, role: m.role,
    authorId: m.authorId, authorName: m.authorName,
    content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
    chat: !!m.chat,
    createdAt: m.createdAt,
  };
}

// ── real SDK run ──
async function runReal(a: {
  ctx: SessionContext; prompt: string; canUseTool: any; emit: Emit; sessionId: string;
  blocks: Block[]; resume?: string | null; abort: AbortController;
  onQuery?: (q: { interrupt: () => Promise<unknown> }) => void;
  onSessionId?: (id: string) => void; // fires as soon as the CLI reports its id, before the turn ends
}): Promise<{ claudeSessionId: string | null; inputTokens: number; outputTokens: number; costUsd: number }> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const options = buildOptions(a.ctx, { canUseTool: a.canUseTool, resume: a.resume, abortController: a.abort });
  const q = query({ prompt: a.prompt, options });
  a.onQuery?.(q as unknown as { interrupt: () => Promise<unknown> }); // expose for interruptTurn()

  let claudeSessionId: string | null = a.resume ?? null;
  let inputTokens = 0, outputTokens = 0, costUsd = 0;
  const toolIndex = new Map<string, number>();

  for await (const msg of q as any) {
    // id first, abort check second: a turn stopped on its very first message still has a transcript
    // worth resuming, and losing the id here is exactly what wipes the next turn's context.
    if (msg?.session_id && msg.session_id !== claudeSessionId) {
      claudeSessionId = msg.session_id;
      a.onSessionId?.(claudeSessionId as string);
    }
    if (a.abort.signal.aborted) break; // interrupted: stop emitting now, don't wait for the SDK to drain
    switch (msg?.type) {
      case 'stream_event': {
        const ev = msg.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          a.emit('assistant:delta', { sessionId: a.sessionId, text: ev.delta.text });
        }
        break;
      }
      case 'assistant': {
        for (const b of msg.message?.content || []) {
          if (b.type === 'text') {
            a.blocks.push({ type: 'text', text: b.text });
            a.emit('assistant:block', { sessionId: a.sessionId, block: { type: 'text', text: b.text } });
          } else if (b.type === 'tool_use') {
            const idx = a.blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input }) - 1;
            toolIndex.set(b.id, idx);
            a.emit('tool:use', { sessionId: a.sessionId, id: b.id, name: b.name, input: b.input });
          }
        }
        break;
      }
      case 'user': {
        const content = msg.message?.content;
        if (Array.isArray(content)) for (const b of content) {
          if (b.type === 'tool_result') {
            const out = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            const idx = toolIndex.get(b.tool_use_id);
            if (idx != null) { (a.blocks[idx] as any).output = out; (a.blocks[idx] as any).isError = !!b.is_error; }
            a.emit('tool:result', { sessionId: a.sessionId, id: b.tool_use_id, output: out, isError: !!b.is_error });
          }
        }
        break;
      }
      case 'result': {
        inputTokens = msg.usage?.input_tokens ?? inputTokens;
        outputTokens = msg.usage?.output_tokens ?? outputTokens;
        costUsd = msg.total_cost_usd ?? costUsd;
        break;
      }
    }
  }
  // interrupt() can end the stream cleanly (no throw); route to the aborted turn:error path so the
  // partial is saved as interrupted and the client clears turnActive.
  if (a.abort.signal.aborted) throw new Error('interrupted');
  return { claudeSessionId, inputTokens, outputTokens, costUsd };
}

// ── mock run (no API key): exercises streaming + permission + tool card ──
async function runMock(a: {
  ctx: SessionContext; prompt: string; canUseTool: any; emit: Emit; sessionId: string;
  blocks: Block[]; signal: AbortSignal;
}) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const stream = async (text: string) => {
    const words = text.split(/(\s+)/);
    let acc = '';
    for (const w of words) {
      if (a.signal.aborted) throw new Error('aborted');
      acc += w;
      a.emit('assistant:delta', { sessionId: a.sessionId, text: w });
      await sleep(18);
    }
    a.blocks.push({ type: 'text', text: acc });
  };

  await stream(`(mock 모드 — API 키 없이 동작 중) 요청 "${a.prompt.slice(0, 80)}" 확인했습니다. 작업 디렉터리를 살펴보겠습니다.`);

  // exercise the permission bridge with a real canUseTool call
  const toolId = 'mock_' + newId();
  const input = { command: 'ls -la' };
  const decision = await a.canUseTool('Bash', input, { signal: a.signal });
  if (decision.behavior === 'allow') {
    a.emit('tool:use', { sessionId: a.sessionId, id: toolId, name: 'Bash', input });
    a.blocks.push({ type: 'tool_use', id: toolId, name: 'Bash', input });
    await sleep(250);
    const out = 'total 8\ndrwxr-xr-x  server.ts  routes.ts  db.ts';
    const idx = a.blocks.findIndex((b) => (b as any).id === toolId);
    if (idx >= 0) (a.blocks[idx] as any).output = out;
    a.emit('tool:result', { sessionId: a.sessionId, id: toolId, output: out, isError: false });
    await stream(` 확인했습니다. 파일 3개가 있네요. 실제 키를 넣으면 여기서 실제 Claude Code가 응답합니다.`);
  } else {
    await stream(` 도구 사용이 거부되어 중단합니다.`);
  }
}
