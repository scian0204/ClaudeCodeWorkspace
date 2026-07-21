import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { paths, ensure } from '../lib/paths.js';
import { allowBypass } from '../lib/settings.js';
import { turnLimiter, withRateLimitRetry } from './throttle.js';
import { buildOptions, clampMode, rootsFor, type SessionContext, type PermMode } from './config-layering.js';
import { makeCanUseTool } from './permissions.js';
import { resolvePluginPaths } from '../plugins/manager.js';
import { recordUsage } from '../usage/tracker.js';
import { resolveClaudeAuth } from '../auth/claude-token.js';

type Emit = (event: string, payload: any) => void;

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean };

interface ActiveTurn { abort: AbortController; }
const active = new Map<string, ActiveTurn>();

export function isTurnActive(sessionId: string) { return active.has(sessionId); }
export function interruptTurn(sessionId: string): boolean {
  const t = active.get(sessionId);
  if (!t) return false;
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

function cwdFor(s: NonNullable<ReturnType<typeof getSession>>): string {
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

function saveMessage(row: {
  sessionId: string; role: string; authorId?: string | null; authorName?: string | null; content: any;
}) {
  const m = {
    id: newId(), sessionId: row.sessionId, role: row.role,
    authorId: row.authorId ?? null, authorName: row.authorName ?? null,
    content: JSON.stringify(row.content), createdAt: Date.now(),
  };
  db.insert(schema.messages).values(m).run();
  return { ...m, content: row.content };
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
  // Probe with the viewer's token (or the owner's for a private session); no token => nothing to probe.
  const auth = resolveClaudeAuth(requesterId ?? (kind === 'user' ? ownerId : null));
  if (auth.source === 'none') return [];
  const plugins = resolvePluginPaths(kind, ownerId);
  const key = `${chatSessionId}|${plugins.join(',')}`;
  const hit = cmdCache.get(key);
  if (hit) return hit;
  const ctx: SessionContext = {
    kind, ownerId, cwd: cwdFor(s), model: s.model || 'claude-opus-4-8',
    permissionMode: clampMode((s.permissionMode as PermMode) || 'default', allowBypass()), plugins,
    authToken: auth.token,
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

export interface RunTurnParams {
  chatSessionId: string;
  author: { id: string; name: string };
  text: string;
  emit: Emit;
}

export async function runTurn(p: RunTurnParams): Promise<void> {
  const s = getSession(p.chatSessionId);
  if (!s) throw new Error('session not found');

  const kind: 'user' | 'room' = s.kind === 'room' ? 'room' : 'user';
  const ownerId = kind === 'room' ? s.roomId! : s.ownerId;
  const cwd = cwdFor(s);
  const mode = clampMode((s.permissionMode as PermMode) || 'default', allowBypass());
  // Each turn runs under its author's token (personal: owner; room: whoever sent this message).
  const auth = resolveClaudeAuth(p.author.id);
  const ctx: SessionContext = {
    kind, ownerId, cwd, model: s.model || 'claude-opus-4-8',
    permissionMode: mode, plugins: resolvePluginPaths(kind, ownerId),
    authToken: auth.token,
  };

  // persist + broadcast the human message (speaker prefix for multi-party rooms)
  const userMsg = saveMessage({
    sessionId: s.id, role: 'user', authorId: p.author.id, authorName: p.author.name,
    content: { text: p.text },
  });
  db.update(schema.chatSessions).set({ updatedAt: Date.now() }).where(eq(schema.chatSessions.id, s.id)).run();
  p.emit('message', { sessionId: s.id, message: publicMessage(userMsg) });

  // global shared-key throttle
  if (turnLimiter.inUse >= turnLimiter.max) p.emit('turn:congested', { sessionId: s.id });
  const release = await turnLimiter.acquire();

  const abort = new AbortController();
  active.set(s.id, { abort });
  p.emit('turn:start', { sessionId: s.id, author: p.author });

  const prompt = kind === 'room' ? `[${p.author.name}]: ${p.text}` : p.text;
  const roots = rootsFor(ctx);
  const canUseTool = makeCanUseTool({
    sessionId: s.id, roots, mode, emit: p.emit, signal: abort.signal,
  });

  const blocks: Block[] = [];
  let newClaudeSessionId: string | null = s.claudeSessionId ?? null;
  let inTok = 0, outTok = 0, cost = 0;

  try {
    if (auth.source === 'none') {
      await runMock({ ctx, prompt: p.text, canUseTool, emit: p.emit, sessionId: s.id, blocks, signal: abort.signal });
      inTok = 12; outTok = 40; cost = 0;
    } else {
      const runOnce = (resume: string | null) => withRateLimitRetry(
        () => runReal({ ctx, prompt, canUseTool, emit: p.emit, sessionId: s.id, blocks, resume, abort }),
        (ms) => p.emit('turn:congested', { sessionId: s.id, backoffMs: ms }),
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
      newClaudeSessionId = res.claudeSessionId ?? newClaudeSessionId;
      inTok = res.inputTokens; outTok = res.outputTokens; cost = res.costUsd;
    }

    const asstMsg = saveMessage({ sessionId: s.id, role: 'assistant', authorName: 'Claude', content: { blocks } });
    if (newClaudeSessionId && newClaudeSessionId !== s.claudeSessionId) {
      db.update(schema.chatSessions).set({ claudeSessionId: newClaudeSessionId, updatedAt: Date.now() })
        .where(eq(schema.chatSessions.id, s.id)).run();
    }
    recordUsage({
      userId: p.author.id, sessionId: s.id, roomId: kind === 'room' ? ownerId : null,
      inputTokens: inTok, outputTokens: outTok, costUsd: cost,
    });
    p.emit('turn:end', {
      sessionId: s.id, message: publicMessage(asstMsg),
      usage: { inputTokens: inTok, outputTokens: outTok, costUsd: cost },
    });
  } catch (e: any) {
    const aborted = abort.signal.aborted;
    p.emit('turn:error', { sessionId: s.id, aborted, error: aborted ? 'interrupted' : String(e?.message || e) });
    if (blocks.length) saveMessage({ sessionId: s.id, role: 'assistant', authorName: 'Claude', content: { blocks, interrupted: aborted } });
  } finally {
    active.delete(s.id);
    release();
  }
}

function publicMessage(m: any) {
  return {
    id: m.id, sessionId: m.sessionId, role: m.role,
    authorId: m.authorId, authorName: m.authorName,
    content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
    createdAt: m.createdAt,
  };
}

// ── real SDK run ──
async function runReal(a: {
  ctx: SessionContext; prompt: string; canUseTool: any; emit: Emit; sessionId: string;
  blocks: Block[]; resume?: string | null; abort: AbortController;
}): Promise<{ claudeSessionId: string | null; inputTokens: number; outputTokens: number; costUsd: number }> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const options = buildOptions(a.ctx, { canUseTool: a.canUseTool, resume: a.resume, abortController: a.abort });
  const q = query({ prompt: a.prompt, options });

  let claudeSessionId: string | null = a.resume ?? null;
  let inputTokens = 0, outputTokens = 0, costUsd = 0;
  const toolIndex = new Map<string, number>();

  for await (const msg of q as any) {
    if (msg?.session_id) claudeSessionId = msg.session_id;
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
