// Name a fresh private chat after what it is actually about. Fires once — right after the first
// turn of a chat that still carries the placeholder title — with one short, tool-less model call
// (cheap model by default). No auth (mock) or a failed/timed-out call falls back to a truncation
// of the first message, so a session always ends up with something better than "새 대화".
// A title the user set themselves is never touched.
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { cfg } from '../lib/config-registry.js';
import { recordUsage } from '../usage/tracker.js';
import { buildOptions, type SessionContext } from './config-layering.js';

export const DEFAULT_TITLE = '새 대화';

type Emit = (event: string, payload: any) => void;

const PROMPT = (text: string, maxChars: number) => `Give this chat a short title, taken from the user's first message.
Reply with the title ONLY: no quotes, no markdown, no trailing punctuation, no explanation.
At most ${maxChars} characters. Write it in the same language the user wrote in. Do not use any tools.

User's first message:
"""
${text.slice(0, 2000)}
"""`;

// First non-empty line, stripped of the wrappers a model tends to add, capped at maxChars.
function clean(raw: string, maxChars: number): string {
  const line = String(raw || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line
    .replace(/^[#>*\-\s]+/, '')            // markdown heading / bullet lead-in
    .replace(/^["'`“”「『]+/, '')
    .replace(/["'`“”」』.。!?！？]+$/, '')
    .trim()
    .slice(0, maxChars)
    .trim();
}

function firstUserText(sessionId: string): string {
  const m = db.select().from(schema.messages)
    .where(and(eq(schema.messages.sessionId, sessionId), eq(schema.messages.role, 'user'), eq(schema.messages.chat, 0)))
    .orderBy(asc(schema.messages.createdAt)).limit(1).get();
  if (!m) return '';
  try { return String((JSON.parse(m.content) as any)?.text || ''); } catch { return ''; }
}

// One-shot query, same short-lived-subprocess trick as probeCommands/probeUsage: tools denied,
// hard timeout via the abort controller, tokens billed to the session owner.
async function askForTitle(a: {
  sessionId: string; ownerId: string; cwd: string; text: string; maxChars: number;
  providerEnv?: Record<string, string>; providerModel?: string;
}): Promise<string> {
  const ctx: SessionContext = {
    kind: 'user', ownerId: a.ownerId, cwd: a.cwd, model: cfg.str('autoTitleModel'),
    permissionMode: 'default', plugins: [], authToken: '',
    providerEnv: a.providerEnv, providerModel: a.providerModel,
  };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), cfg.int('autoTitleTimeoutMs'));
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const options = buildOptions(ctx, {
      canUseTool: async () => ({ behavior: 'deny', message: 'title generation' }),
      abortController: abort,
    });
    const q: any = query({ prompt: PROMPT(a.text, a.maxChars), options });
    let out = '';
    for await (const msg of q) {
      if (abort.signal.aborted) break;
      if (msg?.type === 'assistant') {
        for (const b of msg.message?.content || []) if (b.type === 'text') out += b.text;
      } else if (msg?.type === 'result') {
        recordUsage({
          userId: a.ownerId, sessionId: a.sessionId, roomId: null,
          inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0,
          costUsd: msg.total_cost_usd ?? 0,
        });
        break;
      }
    }
    return clean(out, a.maxChars);
  } finally {
    clearTimeout(timer);
    try { abort.abort(); } catch { /* noop */ }
  }
}

// Best-effort, off the turn's critical path: callers fire-and-forget this.
export async function maybeAutoTitle(p: {
  sessionId: string; cwd: string; hasAuth: boolean; emit: Emit;
  providerEnv?: Record<string, string>; providerModel?: string;
}): Promise<void> {
  if (!cfg.bool('autoTitleEnabled')) return;
  const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, p.sessionId)).get();
  // private chats only (a room is named by its room, a wiki thread by its topic, a review by its PR),
  // and only while the placeholder title is untouched.
  if (!s || s.kind !== 'private' || s.wikiTopicId || s.title !== DEFAULT_TITLE) return;
  const owner = db.select().from(schema.users).where(eq(schema.users.id, s.ownerId)).get();
  if (!owner || owner.autoTitle === 0) return;

  const text = firstUserText(p.sessionId);
  if (!text.trim()) return;
  const maxChars = cfg.int('autoTitleMaxChars');

  let title = '';
  if (p.hasAuth) {
    try { title = await askForTitle({ ...p, ownerId: s.ownerId, text, maxChars }); }
    catch { /* fall through to the truncation fallback */ }
  }
  if (!title) title = clean(text, maxChars);
  if (!title || title === DEFAULT_TITLE) return;

  // re-check: the user may have renamed the chat while the model was thinking
  const fresh = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, p.sessionId)).get();
  if (!fresh || fresh.title !== DEFAULT_TITLE) return;
  db.update(schema.chatSessions).set({ title }).where(eq(schema.chatSessions.id, p.sessionId)).run();
  p.emit('session:title', { sessionId: p.sessionId, title });
}
