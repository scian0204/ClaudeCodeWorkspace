import fs from 'node:fs';
import path from 'node:path';
import { eq, and, desc, gte } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { paths, ensure } from '../lib/paths.js';
import { isBareBasename } from '../lib/attachments.js';
import { allowBypass, getSetting, setSetting } from '../lib/settings.js';
import { turnLimiter, withRateLimitRetry } from './throttle.js';
import { buildOptions, clampMode, rootsFor, type SessionContext, type PermMode } from './config-layering.js';
import { makeCanUseTool, makeAutoAllow } from './permissions.js';
import { composePrompt } from './prompt.js';
import { resolvePluginPaths } from '../plugins/manager.js';
import { resolveAgents } from './team-agents.js';
import { recordUsage, recordSkillUse, turnSkillKeys } from '../usage/tracker.js';
import { resolveProvider } from '../auth/provider.js';
import { hasLogin } from '../auth/claude-login.js';
import { originHost } from '../lib/git-ops.js';
import { resolveGitCred, gitIdentity, identityEnv, askpassEnv } from '../auth/git-cred.js';
import { getReviewByChat, ensureWorktree } from '../review/manager.js';
import { sandboxAvailable, ensureSandbox, removeSandbox, sandboxMcpServer } from '../review/sandbox.js';
import { ensureSessionSandbox, sandboxMcp, sandboxHint, sessionSandboxAvailable } from './session-sandbox.js';
import { poolForSession, runOrder, markExhausted, markAvailable } from '../auth/token-pool.js';
import { cfg } from '../lib/config-registry.js';
import { maybeAutoTitle } from './auto-title.js';
import { maybeWikiLearn } from '../wiki/learn.js';
import { wikiPluginPaths } from '../wiki/plugin.js';
import { isUsageLimitError, resetAtFromError, eligible as autoResumeEligible, parkTurn } from './auto-resume.js';
import { ingestTaskEvent, endRunningTasks } from './tasks.js';
import { limitsSettled } from './usage-limits.js';

export type Emit = (event: string, payload: any) => void;

export type Block =
  // parentId/agentType are set when the block came from a subagent (Task tool) rather than the main
  // thread — nested tool calls get marked cards, nested TEXT is kept out of the main transcript and
  // rendered in the task panel's live view instead.
  | { type: 'text'; text: string; parentId?: string; agentType?: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean; parentId?: string; agentType?: string };

interface ActiveTurn {
  abort: AbortController; blocks: Block[]; author: { id: string; name: string };
  startedAt: number; // when this turn went live (admin process panel: elapsed time)
  query?: { interrupt: () => Promise<unknown> }; // live SDK handle for immediate turn-stop
}
const active = new Map<string, ActiveTurn>();
// When each session's last turn finished. The project watcher needs it: the files a turn writes land
// slightly after the turn ends, and a session must never be told about its own writes.
const endedAt = new Map<string, number>();

export function isTurnActive(sessionId: string) { return active.has(sessionId); }
export function lastTurnEndAt(sessionId: string) { return endedAt.get(sessionId) || 0; }
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
// Display name of whoever's Claude plan a turn ran on (shared-plan pool attribution).
function credentialName(userId: string): string {
  return db.select({ n: schema.users.displayName }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()?.n || '?';
}
function getProject(id: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}
function getWikiTopic(id: string) {
  return db.select().from(schema.wikiTopics).where(eq(schema.wikiTopics.id, id)).get();
}

// House rules for a session that LINKED a wiki topic (as opposed to a wiki query thread, which runs
// inside the topic and gets its CLAUDE.md). Read-only on purpose: the linked base belongs to the
// topic, and the only thing allowed to write into it is the learner (wiki/learn.ts).
function wikiRefHint(name: string, dir: string): string {
  return [
    `## 연결된 LLM Wiki — "${name}"`,
    `이 세션에는 지식 기반이 연결되어 있다: \`${dir}\``,
    `- 주제와 관련된 질문을 받으면 먼저 \`${dir}/wiki/_index.md\`를 읽고 해당 아티클을 확인해라.`,
    `- 그 내용을 근거로 답할 때는 어떤 아티클에서 온 것인지 밝혀라.`,
    `- 이 디렉터리는 읽기 전용이다. 절대 수정·생성·삭제하지 마라.`,
  ].join('\n');
}

// Exported: the session-export route resolves the transcript slug from the same cwd a turn runs with.
export async function cwdFor(s: NonNullable<ReturnType<typeof getSession>>): Promise<string> {
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
  // a wiki thread runs with only the dedicated plugin, so probe with that same set — otherwise the
  // command list advertises skills the turn cannot reach
  const plugins = s.wikiTopicId ? wikiPluginPaths() : resolvePluginPaths(kind, ownerId);
  const key = `${chatSessionId}|${plugins.join(',')}`;
  const hit = cmdCache.get(key);
  if (hit) return hit;
  const ctx: SessionContext = {
    kind, ownerId, cwd: await cwdFor(s), model: s.model || cfg.str('defaultModel'),
    effort: (s.effort || cfg.str('defaultEffort')) as SessionContext['effort'],
    permissionMode: clampMode((s.permissionMode as PermMode) || 'default', allowBypass()), plugins,
    settingSources: s.wikiTopicId ? ['project'] : undefined,
    authToken: '', providerEnv: prov.env, providerModel: prov.model,
  };
  const abort = new AbortController();
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const options = buildOptions(ctx, { canUseTool: async () => ({ behavior: 'deny', message: 'probe' }), abortController: abort });
    const q = query({ prompt: idleInput() as any, options });
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
// Both control-channel probes run against a session that must NOT take a model turn. A one-shot
// string prompt does exactly that — and worse, the query CLOSES as soon as that turn ends, while the
// plan-limit lookup is a live claude.ai call that routinely outlives it (the SDK then rejects with
// "Query closed before response received", which is why an OAuth session reported no rate limits at
// all). Streaming input that never yields keeps the session open until we abort it, and costs nothing.
async function* idleInput(): AsyncGenerator<never> { await new Promise(() => { /* until abort */ }); }

type Win = { utilization: number | null; resetsAt: string | null };
type ModelWin = Win & { displayName: string };
// Which credential ran the probe. Only needed to explain a MISSING plan window: the CLI computes
// rate_limits_available as (user:inference scope && user:profile scope), and a token minted by
// `claude setup-token` is inference-only — so an OAuth token reports no plan window just like an
// API key does, for an entirely different reason. Without this the UI can only guess which.
export type AuthKind = 'oauth' | 'apiKey' | 'other' | 'none';
export interface UsageInfo {
  context: { totalTokens: number; maxTokens: number; percentage: number; model: string } | null;
  rateLimitsAvailable: boolean;
  subscriptionType: string | null;
  rateLimits: { fiveHour: Win | null; sevenDay: Win | null; modelScoped: ModelWin[] } | null;
  authKind: AuthKind;
  // The lookup could not determine the plan windows AND there was no previous value to fall back on.
  // Distinct from "this credential has no plan windows" (an API key), which is a real answer — the
  // popover must not blame the plan/scope for what is really a lookup that did not come back.
  limitsUnknown: boolean;
}
// Key names only — a secret value is never read here, so nothing sensitive can reach the client.
const authKindOf = (env: Record<string, string>): AuthKind =>
  env.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth' : env.ANTHROPIC_API_KEY ? 'apiKey' : Object.keys(env).length ? 'other' : 'none';
const EMPTY_USAGE: UsageInfo = { context: null, rateLimitsAvailable: false, subscriptionType: null, rateLimits: null, authKind: 'none', limitsUnknown: false };
const usageCache = new Map<string, { at: number; data: UsageInfo }>();
// Account-level last-known-good plan limits. A lookup that did not come back (CLI cold start starved
// under heavy load → timeout) must not blank the popover for an account whose limits we reported
// minutes ago — plan windows are account-wide and drift slowly, so serve the previous answer. A
// lookup that ANSWERED "no limits" (API key) is a real answer and never lands here.
// Kept in the settings table rather than in memory: the container is rebuilt on every release, and an
// in-memory copy is empty exactly then — the first popover after a deploy is the one that used to
// come up blank. One row per account, no secrets (utilization %, reset instants, plan name).
type LimitsSlice = Pick<UsageInfo, 'rateLimitsAvailable' | 'subscriptionType' | 'rateLimits'>;
const lastGoodKey = (acctKey: string) => `usage_limits_lastgood:${acctKey}`;
const lastGoodFor = (acctKey: string): LimitsSlice | null => {
  const ttl = cfg.int('usageLastGoodTtlMs');
  if (ttl <= 0) return null;
  try {
    const raw = getSetting(lastGoodKey(acctKey), '');
    if (!raw) return null;
    const { at, d } = JSON.parse(raw) as { at: number; d: LimitsSlice };
    return d && Date.now() - at < ttl ? d : null;
  } catch { return null; } // corrupt row → treat as no previous value
};
const rememberLimits = (acctKey: string, d: LimitsSlice) => {
  try { setSetting(lastGoodKey(acctKey), JSON.stringify({ at: Date.now(), d })); } catch { /* cache only */ }
};
const win = (w: any): Win | null => (w ? { utilization: w.utilization ?? null, resetsAt: w.resets_at ?? null } : null);

// Ask the still-open query for the account figures, re-asking while they are not ready yet. Costs
// nothing but a control round-trip — the model never runs. Bounded by both the retry window and the
// overall probe timeout so a CLI that never answers cannot hold the request open.
async function askLimits(q: any, deadline: number): Promise<any | null> {
  if (typeof q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== 'function') return null;
  const retryUntil = Math.min(deadline, Date.now() + cfg.int('usageLimitsRetryMs'));
  let latest: any = null;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return latest;
    const us = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET().catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), left)),
    ]);
    if (limitsSettled(us)) return us;
    if (us) latest = us; // keep the partial: its subscription_type is still real
    if (Date.now() >= retryUntil) return latest;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function probeUsage(chatSessionId: string, requesterId?: string | null, opts?: { fresh?: boolean }): Promise<UsageInfo> {
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
  // Plan windows need the user:profile scope. A pasted token wins the provider resolution for TURNS
  // (deliberate configuration), but a `claude setup-token` is inference-only, so probing limits with
  // it always reports "unavailable" — even when the same user also has a full-scope browser sign-in.
  // For the account-level LOOKUP only, prefer that sign-in credential: same account, full scopes.
  // CLAUDE_SECURESTORAGE_CONFIG_DIR relocates just the credential store (HOME may be a room's).
  const loginProbe = !!authId && prov.source === 'token' && hasLogin(authId);
  const limitsEnv = loginProbe ? { CLAUDE_SECURESTORAGE_CONFIG_DIR: paths.userClaude(authId!) } : prov.env;
  // A browser sign-in carries no token env (the CLI reads its own credential file), but it is still
  // an OAuth subscription — and the only kind that can actually report plan windows.
  const authKind: AuthKind = prov.source === 'login' || loginProbe ? 'oauth' : authKindOf(prov.env);

  const acctKey = authId ?? 'shared';
  const cacheKey = `${chatSessionId}|${acctKey}`;
  const hit = usageCache.get(cacheKey);
  if (!opts?.fresh && hit && Date.now() - hit.at < cfg.int('usageProbeTtlMs')) return hit.data;

  const ctx: SessionContext = {
    kind, ownerId, cwd: await cwdFor(s), model: s.model || cfg.str('defaultModel'),
    effort: (s.effort || cfg.str('defaultEffort')) as SessionContext['effort'],
    permissionMode: clampMode((s.permissionMode as PermMode) || 'default', allowBypass()),
    plugins: resolvePluginPaths(kind, ownerId), authToken: '', providerEnv: prov.env, providerModel: prov.model,
  };
  const abort = new AbortController();
  const abortLimits = new AbortController();
  const deny = async () => ({ behavior: 'deny' as const, message: 'probe' });
  const withTimeout = <T,>(p: Promise<T>): Promise<T | null> =>
    Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), cfg.int('usageProbeTimeoutMs')))]);
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    // Two sessions, run one after the other. The context breakdown must be session-faithful (resumed
    // transcript + this session's plugins) and that startup costs tens of seconds; the plan-limit
    // lookup is an account-level claude.ai call that needs none of it and answers in ~3s on a bare
    // session. Sharing one query made the account lookup wait behind the heavy startup, and running
    // both at once made two CLI startups fight for the CPU — either way it blew the timeout and the
    // popover reported "no plan limits" for an account that has them.
    // ponytail: two CLI subprocesses per probe, serialized; the TTL cache keeps reopens free.
    const limitsOptions = buildOptions({ ...ctx, plugins: [], providerEnv: limitsEnv }, { canUseTool: deny, abortController: abortLimits });
    // The privacy switches (on by default) cost the popover a whole row. Bisected one var at a time
    // against the live CLI: DISABLE_TELEMETRY=1 and DO_NOT_TRACK=1 — both set by `privacyTelemetry`,
    // and implied by the umbrella var — each make the answer come back WITHOUT `model_scoped`, while
    // the other eleven privacy vars change nothing. So the per-model weekly window silently vanished,
    // and that is usually the first limit an account runs into (91% here while the 5-hour sat at 8%):
    // the popover looked healthy while hiding the only number that mattered.
    // Reading your own plan windows is the feature, not background chatter, so by default lift just
    // those vars for THIS lookup — a bare session that runs no model turn. Everything else (turns,
    // command probes, the context probe) keeps the admin's privacy settings untouched, and an operator
    // who would rather block the traffic can turn `usageLimitsFullDetail` off and lose only that row.
    if (cfg.bool('usageLimitsFullDetail')) {
      for (const k of ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_TELEMETRY', 'DO_NOT_TRACK']) {
        delete limitsOptions.env[k];
      }
    }
    const qLimits: any = query({ prompt: idleInput() as any, options: limitsOptions });
    const us = await askLimits(qLimits, Date.now() + cfg.int('usageProbeTimeoutMs'));
    try { abortLimits.abort(); } catch { /* noop */ }

    const options = buildOptions(ctx, { canUseTool: deny, resume: s.claudeSessionId, abortController: abort });
    const q: any = query({ prompt: idleInput() as any, options });
    const cu = typeof q.getContextUsage === 'function' ? await withTimeout(q.getContextUsage()) : null;
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
      authKind,
      limitsUnknown: false,
    };
    // Cache only a lookup that actually SETTLED. One that timed out, errored, or came back not-ready
    // (`rate_limits: null` while available) must not pin "no plan limits" for the whole TTL, and must
    // never become the account's last-known-good: reopening the popover should retry, not re-serve it.
    if (limitsSettled(us)) {
      usageCache.set(cacheKey, { at: Date.now(), data });
      rememberLimits(acctKey, { rateLimitsAvailable: data.rateLimitsAvailable, subscriptionType: data.subscriptionType, rateLimits: data.rateLimits });
    } else {
      usageCache.delete(cacheKey);
      const lg = lastGoodFor(acctKey);
      if (lg) Object.assign(data, lg);
      else Object.assign(data, { rateLimitsAvailable: false, subscriptionType: null, rateLimits: null, limitsUnknown: true });
      console.warn(`[usage] limits lookup unsettled (session=${chatSessionId}, partial=${!!us})${lg ? ' — served last-known-good' : ''}`);
    }
    return data;
  } catch {
    const lg = lastGoodFor(acctKey);
    return { ...EMPTY_USAGE, authKind, ...(lg ?? { limitsUnknown: true }) };
  }
  finally {
    try { abort.abort(); } catch { /* noop */ }
    try { abortLimits.abort(); } catch { /* noop */ }
  }
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
  // With a shared-plan pool bound, `order` is the list of members to draw credentials from instead:
  // the first entry runs, the rest are fallbacks for a spent plan window (the sender is always last).
  const poolId = poolForSession(s, p.author.id);
  const order = poolId ? runOrder(poolId, p.author.id) : [p.author.id];
  let credentialId = order[0];
  let prov = resolveProvider(credentialId);
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
  let systemPromptAppend: string | undefined;
  // Ordinary session with its own build container turned on: expose mcp__sandbox__run and tell the
  // agent to build/run there. Bash stays allowed (git/grep/file work has no reason to pay for a
  // container hop) — unlike review, this code is the team's own. Kept alive between turns and
  // reaped on idle, so it is NOT torn down in `finally`.
  if (s.kind !== 'review' && s.sandbox === 1 && sessionSandboxAvailable()) {
    try {
      const cname = await ensureSessionSandbox(s.id, cwd);
      if (cname) {
        mcpServers = { sandbox: await sandboxMcp(cname, cwd) };
        systemPromptAppend = sandboxHint(cwd);
      }
    } catch { /* container failed to start → host exec, exactly as before */ }
  }
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

  // Linked LLM Wiki: an ordinary session may name a topic as reference knowledge. The topic dir is
  // added to the turn's readable roots and the agent is told where it is and how to use it — the
  // session keeps its own cwd/project, the wiki is just a second place to look things up.
  let extraRoots: string[] | undefined;
  if (s.wikiRefId && cfg.bool('wikiLinkEnabled')) {
    const wt = getWikiTopic(s.wikiRefId);
    if (wt && fs.existsSync(wt.path)) {
      extraRoots = [wt.path];
      systemPromptAppend = [systemPromptAppend, wikiRefHint(wt.name, wt.path)].filter(Boolean).join('\n\n');
    }
  }

  // A wiki query thread is a knowledge lookup, not the team's coding session, so it does NOT inherit
  // the workspace's plugins, the operator's personal settings layer, or the team agent definitions —
  // all three showed up in answers (another plugin's writing style, a hook that made every write run
  // twice). It gets one plugin, its own topic's CLAUDE.md, and nothing else. See wiki/plugin.ts.
  const isWikiThread = !!s.wikiTopicId;

  const ctx: SessionContext = {
    kind, ownerId, cwd, model: s.model || cfg.str('defaultModel'),
    effort: (s.effort || cfg.str('defaultEffort')) as SessionContext['effort'],
    permissionMode: mode, plugins: isWikiThread ? wikiPluginPaths() : resolvePluginPaths(kind, ownerId),
    settingSources: isWikiThread ? ['project'] : undefined,
    authToken: '', providerEnv: prov.env, providerModel: prov.model, gitEnv, mcpServers, disallowedTools, systemPromptAppend, extraRoots,
    agents: isWikiThread ? undefined : resolveAgents(kind, ownerId, s.projectId), agentName: s.agent || undefined,
    unattended: s.kind === 'review', // review turns auto-allow (makeAutoAllow) — no human prompts
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
  const tEnqueued = Date.now();
  if (turnLimiter.inUse >= turnLimiter.max) p.emit('turn:congested', { sessionId: s.id });
  const release = await turnLimiter.acquire();
  const tStarted = Date.now();
  // One line per turn so "why was that slow?" is answerable from the log instead of guessed at:
  // slot = time blocked on the global concurrency cap (maxConcurrentTurns), ttft = spawn + model time
  // until the first visible output, total = everything. A big `slot` means another session's turn was
  // holding the cap; a big `ttft` means the CLI/model itself was slow.
  let tFirstOut = 0;
  const emit: Emit = (event, payload) => {
    if (!tFirstOut && (event === 'assistant:delta' || event === 'assistant:block' || event === 'tool:use')) tFirstOut = Date.now();
    p.emit(event, payload);
  };

  const abort = new AbortController();
  const blocks: Block[] = [];
  const turn: ActiveTurn = { abort, blocks, author: p.author, startedAt: Date.now() }; // blocks kept live so join can replay progress
  active.set(s.id, turn);
  p.emit('turn:start', {
    sessionId: s.id, author: p.author,
    ...(poolId && credentialId !== p.author.id ? { credential: credentialName(credentialId) } : {}),
  });

  // Speaker prefix / chat catch-up / attachment paths \u2014 and a slash command left exactly as typed so
  // the CLI still recognises it (claude/prompt.ts explains why that mattered). The REAL prompt only;
  // the mock path uses p.text and doesn't run an agent. p.text arrives trimmed (chat:send).
  const prompt = composePrompt({
    text: p.text, kind, authorName: p.author.name, contextChat, attachments,
  });
  const roots = rootsFor(ctx);
  // review sessions run the pipeline unattended → auto-allow tools (class-1 fence still applies)
  const canUseTool = s.kind === 'review'
    ? makeAutoAllow(roots)
    : makeCanUseTool({ sessionId: s.id, roots, mode, emit, signal: abort.signal });

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
      await runMock({ ctx, prompt: p.text, canUseTool, emit, sessionId: s.id, blocks, signal: abort.signal });
      inTok = 12; outTok = 40; cost = 0;
    } else {
      const runOnce = (resume: string | null) => withRateLimitRetry(
        () => runReal({ ctx, prompt, canUseTool, emit, sessionId: s.id, blocks, resume, abort,
          onQuery: (q) => { turn.query = q; }, onSessionId: rememberSessionId }),
        (ms) => p.emit('turn:congested', { sessionId: s.id, backoffMs: ms }),
        abort.signal, // a stop during rate-limit backoff must break the sleep, not wait it out
      );
      const attempt = async (): Promise<Awaited<ReturnType<typeof runOnce>>> => {
        try {
          return await runOnce(s.claudeSessionId);
        } catch (e: any) {
          // Stale resume id (transcript missing for this cwd, e.g. after a project switch)
          // → drop the resume and start a fresh conversation once instead of failing the turn.
          if (s.claudeSessionId && !abort.signal.aborted && /No conversation found/i.test(String(e?.message || e))) {
            blocks.length = 0;
            return await runOnce(null);
          }
          throw e;
        }
      };
      let res;
      // Shared-plan pool: a member whose plan window turns out to be spent is put on cooldown and the
      // SAME prompt is retried on the next member's plan, rather than failing the turn. Only the
      // plan-window error qualifies (a real 429 was already retried inside withRateLimitRetry), and
      // only up to tokenPoolMaxFallback further members.
      const maxFallback = poolId ? Math.min(cfg.int('tokenPoolMaxFallback'), order.length - 1) : 0;
      for (let i = 0; ; i++) {
        try {
          res = await attempt();
          if (poolId) markAvailable(poolId, credentialId); // it ran → that window is demonstrably open
          break;
        } catch (e: any) {
          const msg = String(e?.message || e);
          if (abort.signal.aborted || i >= maxFallback || !isUsageLimitError(msg)) throw e;
          markExhausted(poolId!, credentialId, resetAtFromError(msg));
          credentialId = order[i + 1];
          prov = resolveProvider(credentialId);
          if (prov.source === 'none') throw e; // that member has no usable credential after all
          ctx.providerEnv = prov.env;
          ctx.providerModel = prov.model;
          blocks.length = 0; // the failed attempt produced nothing worth keeping
          p.emit('turn:poolFallback', { sessionId: s.id, credential: credentialName(credentialId) });
        }
      }
      if (res.claudeSessionId) rememberSessionId(res.claudeSessionId); // no-op unless the stream never reported it
      inTok = res.inputTokens; outTok = res.outputTokens; cost = res.costUsd;
    }

    // Whose plan paid for the turn. Only recorded when it wasn't the sender's own — that is exactly
    // the case the transcript has to be honest about, and it keeps every pre-pool message unchanged.
    const onPlanOf = credentialId !== p.author.id ? credentialName(credentialId) : null;
    const asstMsg = saveMessage({
      sessionId: s.id, role: 'assistant', authorName: 'Claude',
      content: onPlanOf ? { blocks, onPlanOf } : { blocks },
    });
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
    // a thread bound to a wiki topic (its own, or one it linked) offers the exchange to the topic —
    // the model decides whether anything durable came out of it (wiki/learn.ts)
    void maybeWikiLearn({
      sessionId: s.id, author: p.author, emit: p.emit, hasAuth: prov.source !== 'none',
      providerEnv: prov.env, providerModel: prov.model,
    }).catch(() => { /* learning is opportunistic — never surface it as a turn failure */ });
  } catch (e: any) {
    const aborted = abort.signal.aborted;
    const errMsg = aborted ? 'interrupted' : String(e?.message || e);
    // The author's claude.ai plan window is exhausted (not a transient 429 — withRateLimitRetry
    // already handled those). If they opted in, park the prompt and re-run it when the window
    // resets instead of losing it. Never blocks the failure path: a park error still reports.
    let resumeAt: number | null = null;
    if (!aborted && isUsageLimitError(errMsg) && autoResumeEligible(p.author.id, prov.env, s.kind, prov.source === 'login')) {
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
    endedAt.set(s.id, Date.now());
    release();
    const done = Date.now();
    console.log(`[turn] ${s.id} slot=${tStarted - tEnqueued}ms ttft=${tFirstOut ? tFirstOut - tStarted : -1}ms total=${done - tEnqueued}ms in=${inTok} out=${outTok} cap=${turnLimiter.inUse}/${turnLimiter.max}`);
    // The CLI subprocess dies with the turn, so anything it spawned is gone whether it reported or
    // not — settle every still-running row instead of leaving the panel spinning. Guarded: a throw
    // here would replace the turn's own outcome and skip the sandbox teardown below.
    try { endRunningTasks(s.id, p.emit); } catch { /* panel bookkeeping is cosmetic */ }
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
  // Running totals broadcast mid-turn (turn:usage). Input arrives at each message's START, so the
  // meter moves the moment an agent-loop iteration begins — before any text or thinking exists.
  let streamIn = 0, streamOut = 0;
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
        // A thinking block OPENS here, before its first delta — flag it right away so the composer
        // says "생각 중" instead of a generic wait for however long the first chunk takes.
        if (ev?.type === 'content_block_start' && ev.content_block?.type === 'thinking' && !msg.parent_tool_use_id) {
          a.emit('assistant:thinking', { sessionId: a.sessionId, len: 0 });
        } else if (ev?.type === 'message_start' && ev.message?.usage) {
          // Input tokens for this agent-loop iteration — the context, re-billed on every iteration and
          // usually the bulk of a tool-heavy turn. Reported at the START, so the meter stops looking
          // frozen while the model thinks or a tool runs. Cache reads/writes are billed too, so they
          // count; the `result` message's own input_tokens is the authoritative final figure.
          const u = ev.message.usage;
          streamIn += (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0)
            + (Number(u.cache_creation_input_tokens) || 0);
          a.emit('turn:usage', { sessionId: a.sessionId, inputTokens: streamIn, outputTokens: streamOut });
        } else if (ev?.type === 'content_block_delta') {
          const d = ev.delta;
          if (d?.type === 'text_delta') {
            // Subagent partials must not leak into the main thread's text — they stream to the task
            // panel's live view instead, keyed by the spawning Task call's tool_use id.
            if (msg.parent_tool_use_id) a.emit('subagent:delta', { sessionId: a.sessionId, parentId: String(msg.parent_tool_use_id), text: d.text });
            else a.emit('assistant:delta', { sessionId: a.sessionId, text: d.text });
          } else if (d?.type === 'thinking_delta') {
            // extended thinking: the client only needs "still thinking" + how much, never the text
            if (!msg.parent_tool_use_id) a.emit('assistant:thinking', { sessionId: a.sessionId, len: String(d.thinking || '').length });
          }
        } else if (ev?.type === 'message_delta' && ev.usage?.output_tokens != null) {
          // exact output tokens, cumulative per assistant message — a turn has one per agent-loop
          // iteration, so sum them. The client interpolates between these with a char estimate.
          streamOut += Number(ev.usage.output_tokens) || 0;
          a.emit('turn:usage', { sessionId: a.sessionId, inputTokens: streamIn, outputTokens: streamOut });
        }
        break;
      }
      case 'assistant': {
        // Subagent messages ride the same stream as the main thread's, told apart only by
        // parent_tool_use_id — carry it through so nested work renders in the task panel.
        const nested = msg.parent_tool_use_id
          ? { parentId: String(msg.parent_tool_use_id), ...(msg.subagent_type ? { agentType: String(msg.subagent_type) } : {}) }
          : null;
        for (const b of msg.message?.content || []) {
          if (b.type === 'text') {
            a.blocks.push({ type: 'text', text: b.text, ...(nested || {}) });
            if (nested) a.emit('subagent:block', { sessionId: a.sessionId, ...nested, text: b.text });
            else a.emit('assistant:block', { sessionId: a.sessionId, block: { type: 'text', text: b.text } });
          } else if (b.type === 'tool_use') {
            const idx = a.blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input, ...(nested || {}) }) - 1;
            toolIndex.set(b.id, idx);
            a.emit('tool:use', { sessionId: a.sessionId, id: b.id, name: b.name, input: b.input, ...(nested || {}) });
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
      // Subagents / backgrounded shells / workflows report only on this channel — fold them into the
      // session's task list (the right-side task panel) instead of dropping them on the floor.
      case 'system': {
        ingestTaskEvent(a.sessionId, msg, a.emit);
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

  // a short thinking phase before the first token, so the "thinking" mark and the live token
  // meter are exercisable without an API key
  a.emit('turn:usage', { sessionId: a.sessionId, inputTokens: 3400, outputTokens: 0 });
  for (let i = 0; i < 10; i++) {
    if (a.signal.aborted) throw new Error('aborted');
    a.emit('assistant:thinking', { sessionId: a.sessionId, len: 36 });
    await sleep(90);
  }

  await stream(`(mock 모드 — API 키 없이 동작 중) 요청 "${a.prompt.slice(0, 80)}" 확인했습니다. 작업 디렉터리를 살펴보겠습니다.`);
  a.emit('turn:usage', { sessionId: a.sessionId, inputTokens: 3400, outputTokens: 120 });

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
