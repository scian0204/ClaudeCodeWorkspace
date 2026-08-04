// The guide agent's turn runner.
//
// A deliberately small, separate agent — NOT a chat session. It has no project, no filesystem, no
// plugins and no user CLAUDE.md: its entire tool surface is two in-process MCP tools (`api` and
// `ui`), and every built-in tool is denied. That is what makes "모든 기능 지원 + 사용자별 권한 제한"
// tractable: `api` re-enters this very server through app.inject() with the caller's own session
// cookie, so each route runs its normal requireAuth / requireAdmin / ownership checks. There is no
// second copy of the permission rules to keep in sync.
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { paths, ensure } from '../lib/paths.js';
import { cfg } from '../lib/config-registry.js';
import { resolveProvider, PROVIDER_ENV_KEYS } from '../auth/provider.js';
import { privacyPlan, applyPrivacyEnv } from '../claude/privacy.js';
import type { AuthUser } from '../auth/index.js';
import { buildSystemPrompt } from './prompt.js';
import { findRoute, type Method } from './api-map.js';
import { findUiAction } from './ui-actions.js';

export type Emit = (event: string, payload: any) => void;

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean };

// Every built-in the CLI ships. The guide has no business touching a filesystem or a shell, and
// `canUseTool` below refuses them again — two independent gates, because one config typo here
// would otherwise hand a chat panel a shell.
const DENIED_BUILTINS = [
  'Bash', 'BashOutput', 'KillShell', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'SlashCommand', 'ExitPlanMode',
];
const API_TOOL = 'mcp__ccw__api';
const UI_TOOL = 'mcp__ccw__ui';

// ── per-user thread state ──
function thread(userId: string) {
  return db.select().from(schema.guideThreads).where(eq(schema.guideThreads.userId, userId)).get();
}
function setResume(userId: string, claudeSessionId: string | null) {
  const now = Date.now();
  if (thread(userId)) {
    db.update(schema.guideThreads).set({ claudeSessionId, updatedAt: now })
      .where(eq(schema.guideThreads.userId, userId)).run();
  } else {
    db.insert(schema.guideThreads).values({ userId, claudeSessionId, updatedAt: now }).run();
  }
}

function saveMessage(userId: string, role: 'user' | 'assistant', content: any) {
  const row = { id: newId(), userId, role, content: JSON.stringify(content), createdAt: Date.now() };
  db.insert(schema.guideMessages).values(row).run();
  return { id: row.id, role, content, createdAt: row.createdAt };
}

// Newest `limit` messages, oldest-first (the panel renders them top to bottom).
export function guideHistory(userId: string, limit = 200) {
  const rows = db.select().from(schema.guideMessages)
    .where(eq(schema.guideMessages.userId, userId)).orderBy(schema.guideMessages.createdAt).all();
  return rows.slice(-limit).map((m) => ({ id: m.id, role: m.role, content: JSON.parse(m.content), createdAt: m.createdAt }));
}

// "Start over": drop the transcript AND the SDK resume id, so the next turn is a clean conversation.
export function clearGuide(userId: string) {
  db.delete(schema.guideMessages).where(eq(schema.guideMessages.userId, userId)).run();
  setResume(userId, null);
}

// ── in-flight turns (one per user; also what `interruptGuide` cancels) ──
interface Active { abort: AbortController; query?: { interrupt: () => Promise<unknown> } }
const active = new Map<string, Active>();

export function guideBusy(userId: string): boolean { return active.has(userId); }
export function interruptGuide(userId: string): boolean {
  const a = active.get(userId);
  if (!a) return false;
  try { void a.query?.interrupt().catch(() => { /* abort below is the fallback */ }); } catch { /* noop */ }
  a.abort.abort();
  return true;
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max)}\n…[truncated, ${s.length} chars total]`);

// ── the two tools ──
async function buildMcpServer(a: {
  app: FastifyInstance; user: AuthUser; cookie: string; emit: Emit; writeEnabled: boolean;
}) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk');
  const isAdmin = a.user.role === 'admin';
  const maxChars = cfg.int('guideMaxToolChars');
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

  return createSdkMcpServer({
    name: 'ccw',
    version: '1.0.0',
    tools: [
      tool(
        'api',
        'Call the workspace HTTP API as the signed-in user. Runs through the real routes, so the '
        + 'server enforces exactly the permissions that user has in the UI. Only the routes listed in '
        + 'your system prompt are reachable; anything else is refused. Returns "status=<code>" then the '
        + 'JSON response body.',
        {
          method: z.enum(['GET', 'POST', 'PUT', 'PATCH']).describe('HTTP method'),
          path: z.string().describe('API path starting with /api, e.g. "/api/sessions" or "/api/search?q=auth"'),
          body: z.record(z.string(), z.any()).optional().describe('JSON request body (write methods only)'),
        },
        async (args: { method: Method; path: string; body?: Record<string, unknown> }) => {
          const method = String(args.method).toUpperCase() as Method;
          const path = String(args.path || '');
          if (!path.startsWith('/api/')) return text('status=400\n{"error":"path must start with /api/"}');
          const route = findRoute(method, path);
          if (!route) return text(`status=403\n{"error":"${method} ${path} is not one of the routes you may call"}`);
          if (route.admin && !isAdmin) return text('status=403\n{"error":"admin only"}'); // the route re-checks too
          if (method !== 'GET' && !a.writeEnabled) {
            return text('status=403\n{"error":"the administrator has put the guide in read-only mode"}');
          }
          // Re-enter this same Fastify app with the caller's cookie → attachUser + every route guard runs.
          const res = await a.app.inject({
            method: method as any,
            url: path,
            headers: { cookie: a.cookie, 'content-type': 'application/json' },
            payload: method === 'GET' ? undefined : JSON.stringify(args.body ?? {}),
          });
          return text(`status=${res.statusCode}\n${clip(res.body || '', maxChars)}`);
        },
      ),
      tool(
        'ui',
        "Do something in the user's browser (applies to every tab they have open) — navigation, "
        + 'language, theme, and the dialogs that have no API. Returns "ok" once dispatched.',
        {
          action: z.string().describe('one of the ui actions listed in your system prompt, e.g. "setLanguage"'),
          value: z.string().optional().describe('the action\'s value where it takes one, e.g. "en"'),
        },
        async (args: { action: string; value?: string }) => {
          if (!a.writeEnabled) return text('refused: the administrator has put the guide in read-only mode');
          const found = findUiAction(args.action, isAdmin);
          if (!found) return text(`refused: "${args.action}" is not a ui action available to you`);
          a.emit('guide:action', { action: found.action, value: args.value ?? null });
          return text(`ok — dispatched ${found.action}${args.value ? ` (${args.value})` : ''}`);
        },
      ),
    ],
  });
}

const MOCK_REPLY = "No Claude credentials are configured for your account yet, so I can't answer or act. "
  + 'Register a Claude token on **My Page**, or ask an administrator to set a shared one.'
  + '\n\nClaude 자격증명이 없어 답변·동작을 할 수 없습니다. **마이 페이지**에서 Claude 토큰을 등록하거나 관리자에게 공용 토큰 설정을 요청하세요.';

export interface RunGuideParams {
  app: FastifyInstance;
  user: AuthUser;
  cookie: string; // the caller's raw Cookie header — replayed into app.inject so routes see the session
  text: string;
  lang: string;
  emit: Emit;
}

export async function runGuideTurn(p: RunGuideParams): Promise<void> {
  const userId = p.user.id;
  if (active.has(userId)) throw new Error('busy');

  p.emit('guide:message', { message: saveMessage(userId, 'user', { text: p.text }) });

  const abort = new AbortController();
  const state: Active = { abort };
  active.set(userId, state);
  p.emit('guide:start', {});

  const blocks: Block[] = [];
  const prov = resolveProvider(userId);
  const writeEnabled = cfg.bool('guideWriteEnabled');

  try {
    if (prov.source === 'none') {
      // No Claude auth (mock deployment, or the user never registered a token). Say so plainly
      // rather than pretending to be an assistant that cannot answer anything.
      blocks.push({ type: 'text', text: MOCK_REPLY });
      p.emit('guide:delta', { text: MOCK_REPLY });
    } else {
      const home = paths.userHome(userId);
      ensure(home);
      const env: Record<string, string> = { ...process.env } as any;
      env.HOME = home;
      for (const k of PROVIDER_ENV_KEYS) delete env[k]; // never let a host-global provider var bleed in
      Object.assign(env, prov.env);
      const privacy = privacyPlan((k) => cfg.bool(k));
      applyPrivacyEnv(env, privacy);

      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const options: any = {
        cwd: home,
        env,
        model: prov.model || cfg.str('guideModel'),
        systemPrompt: buildSystemPrompt({ user: p.user, lang: p.lang, writeEnabled }),
        settingSources: [], // no user/project settings, no CLAUDE.md, no plugin skills — just the guide
        permissionMode: 'default',
        maxTurns: cfg.int('guideMaxTurns'),
        mcpServers: { ccw: await buildMcpServer({ app: p.app, user: p.user, cookie: p.cookie, emit: p.emit, writeEnabled }) },
        allowedTools: [API_TOOL, UI_TOOL],
        disallowedTools: DENIED_BUILTINS,
        // Final gate: allow our two tools, refuse everything else. Never prompts the user — a guide
        // panel has no approval UI, and anything needing approval is out of scope by construction.
        canUseTool: async (name: string) => (name === API_TOOL || name === UI_TOOL
          ? { behavior: 'allow', updatedInput: undefined }
          : { behavior: 'deny', message: `${name} is not available to the guide assistant` }),
        abortController: abort,
        includePartialMessages: true,
      };
      if (privacy.settings && Object.keys(privacy.settings).length) options.settings = privacy.settings;
      const ccPath = cfg.str('claudeCodePath');
      if (ccPath) options.pathToClaudeCodeExecutable = ccPath;
      const resume = thread(userId)?.claudeSessionId;
      if (resume) options.resume = resume;

      await stream({ query, options, prompt: p.text, blocks, emit: p.emit, abort, userId, onQuery: (q) => { state.query = q; } });
    }
    p.emit('guide:end', { message: saveMessage(userId, 'assistant', { blocks }) });
  } catch (e: any) {
    const aborted = abort.signal.aborted;
    if (blocks.length) p.emit('guide:end', { message: saveMessage(userId, 'assistant', { blocks, interrupted: aborted }) });
    p.emit('guide:error', { aborted, error: aborted ? 'interrupted' : String(e?.message || e) });
  } finally {
    active.delete(userId);
  }
}

// Drive one SDK query, streaming deltas / tool cards out as they arrive. A stale resume id (the
// transcript was pruned) restarts the conversation once rather than failing the turn.
async function stream(a: {
  query: any; options: any; prompt: string; blocks: Block[]; emit: Emit;
  abort: AbortController; userId: string; onQuery: (q: { interrupt: () => Promise<unknown> }) => void;
}) {
  const once = async (resume: string | null | undefined) => {
    const options = { ...a.options };
    if (resume) options.resume = resume; else delete options.resume;
    const q = a.query({ prompt: a.prompt, options });
    a.onQuery(q as { interrupt: () => Promise<unknown> });
    let claudeSessionId: string | null = resume ?? null;
    const toolIndex = new Map<string, number>();
    for await (const msg of q as any) {
      if (a.abort.signal.aborted) break;
      if (msg?.session_id) claudeSessionId = msg.session_id;
      switch (msg?.type) {
        case 'stream_event': {
          const ev = msg.event;
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            a.emit('guide:delta', { text: ev.delta.text });
          }
          break;
        }
        case 'assistant': {
          for (const b of msg.message?.content || []) {
            if (b.type === 'text') {
              a.blocks.push({ type: 'text', text: b.text });
            } else if (b.type === 'tool_use') {
              const idx = a.blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input }) - 1;
              toolIndex.set(b.id, idx);
              a.emit('guide:tool', { id: b.id, name: b.name, input: b.input });
            }
          }
          break;
        }
        case 'user': {
          const content = msg.message?.content;
          if (Array.isArray(content)) for (const b of content) {
            if (b.type !== 'tool_result') continue;
            const out = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            const idx = toolIndex.get(b.tool_use_id);
            if (idx != null) { (a.blocks[idx] as any).output = out; (a.blocks[idx] as any).isError = !!b.is_error; }
            a.emit('guide:toolResult', { id: b.tool_use_id, output: out, isError: !!b.is_error });
          }
          break;
        }
      }
    }
    if (a.abort.signal.aborted) throw new Error('interrupted');
    setResume(a.userId, claudeSessionId);
  };

  const resume = a.options.resume;
  try {
    await once(resume);
  } catch (e: any) {
    if (!resume || a.abort.signal.aborted || !/No conversation found/i.test(String(e?.message || e))) throw e;
    a.blocks.length = 0;
    await once(null);
  }
}
