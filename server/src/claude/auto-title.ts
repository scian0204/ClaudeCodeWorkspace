// Name a fresh private chat after what it is actually about. Fires once — right after the first
// turn of a chat that still carries the placeholder title — with one short, tool-less model call
// (cheap model by default). No auth (mock) or a failed/timed-out call falls back to a truncation
// of the first message, so a session always ends up with something better than "새 대화".
// A title the user set themselves is never touched.
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { cfg } from '../lib/config-registry.js';
import { cleanTitle } from '../lib/session-import.js';
import { paths, ensure } from '../lib/paths.js';
import { resolveProvider } from '../auth/provider.js';
import { recordUsage } from '../usage/tracker.js';
import { buildOptions, type SessionContext } from './config-layering.js';

export const DEFAULT_TITLE = '새 대화';

type Emit = (event: string, payload: any) => void;

// One message for a fresh chat, several turns for an imported transcript — same prompt covers both.
const PROMPT = (text: string, maxChars: number) => `Give this chat a short title, taken from what the user asked about.
Reply with the title ONLY: no quotes, no markdown, no trailing punctuation, no explanation.
At most ${maxChars} characters. Write it in the same language the user wrote in. Do not use any tools.

What the user wrote:
"""
${text.slice(0, 2000)}
"""`;

// The user's side of a chat, oldest first. One message is enough to name a brand-new chat; naming a
// conversation that already ran needs a few turns, so the count is shared with the import path.
function userDigest(sessionId: string, limit: number): string {
  const rows = db.select().from(schema.messages)
    .where(and(eq(schema.messages.sessionId, sessionId), eq(schema.messages.role, 'user'), eq(schema.messages.chat, 0)))
    .orderBy(asc(schema.messages.createdAt)).limit(limit).all();
  return rows
    .map((m) => { try { return String((JSON.parse(m.content) as any)?.text || '').trim(); } catch { return ''; } })
    .filter((s) => s && !/^\/[a-z][\w:-]*(\s|$)/i.test(s)) // a slash command is not what the chat is about
    .join('\n---\n');
}
function firstUserText(sessionId: string): string { return userDigest(sessionId, 1); }

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
    return cleanTitle(out, a.maxChars);
  } finally {
    clearTimeout(timer);
    try { abort.abort(); } catch { /* noop */ }
  }
}

// Ask the model, falling back to a truncation of the text itself. Never throws — a session always
// ends up with something readable.
async function titleFor(a: {
  sessionId: string; ownerId: string; cwd: string; text: string; maxChars: number; hasAuth: boolean;
  providerEnv?: Record<string, string>; providerModel?: string;
}): Promise<string> {
  let title = '';
  if (a.hasAuth) {
    try { title = await askForTitle(a); } catch { /* fall through to the truncation fallback */ }
  }
  return title || cleanTitle(a.text, a.maxChars);
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

  const title = await titleFor({ ...p, ownerId: s.ownerId, text, maxChars });
  if (!title || title === DEFAULT_TITLE) return;

  // re-check: the user may have renamed the chat while the model was thinking
  const fresh = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, p.sessionId)).get();
  if (!fresh || fresh.title !== DEFAULT_TITLE) return;
  db.update(schema.chatSessions).set({ title }).where(eq(schema.chatSessions.id, p.sessionId)).run();
  p.emit('session:title', { sessionId: p.sessionId, title });
}

// Where a one-shot titling call runs. Private chats only, so this is the project dir or, with no
// project, the user's project root — mirrors session-manager.cwdFor for that case.
function cwdForPrivate(s: { ownerId: string; projectId: string | null }): string {
  if (s.projectId) {
    const p = db.select().from(schema.projects).where(eq(schema.projects.id, s.projectId)).get();
    if (p) { ensure(p.path); return p.path; }
  }
  const dir = paths.userProjects(s.ownerId);
  ensure(dir);
  return dir;
}

// The manual "name this chat" button. Unlike maybeAutoTitle this does NOT require the placeholder
// title or the user's auto-naming preference — pressing the button IS the request, and replacing a
// name the user is looking at is the whole point. Reads several turns rather than just the first,
// since a chat that has already run is not described by its opening message.
// Throws (with a reason the UI shows) instead of failing quietly: the caller asked for this.
export async function retitleSession(p: { sessionId: string; requesterId: string; emit: Emit }): Promise<string> {
  if (!cfg.bool('autoTitleEnabled')) throw new Error('automatic session names are disabled');
  const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, p.sessionId)).get();
  if (!s) throw new Error('session not found');
  // a room is named by its room, a wiki thread by its topic, a review by its PR — nothing to do
  if (s.kind !== 'private' || s.wikiTopicId) throw new Error('only private chats can be renamed this way');

  const text = userDigest(p.sessionId, cfg.int('importAutoTitleMessages'));
  if (!text.trim()) throw new Error('nothing to read yet — send a message first');

  // Billed to whoever pressed the button, run under their auth.
  const prov = resolveProvider(p.requesterId);
  if (prov.source === 'none') throw new Error('no Claude auth available — register a token first');

  const title = await titleFor({
    sessionId: p.sessionId, ownerId: p.requesterId, cwd: cwdForPrivate(s), text,
    maxChars: cfg.int('autoTitleMaxChars'), hasAuth: true,
    providerEnv: prov.env, providerModel: prov.model,
  });
  if (!title) throw new Error('could not generate a name');

  db.update(schema.chatSessions).set({ title }).where(eq(schema.chatSessions.id, p.sessionId)).run();
  p.emit('session:title', { sessionId: p.sessionId, title });
  return title;
}

// Same naming pass for a chat cloned by the local-session import. The transcript carried no
// custom-title, so the row currently holds the snippet listSessions read off the first message —
// upgrade it to a real title read from several turns of the imported conversation. Whether to run
// at all is the importer's choice (a checkbox on the import screen), so there is no preference
// check here. The caller fires this after responding; the title arrives over `session:title`.
export async function autoTitleImported(p: {
  sessionId: string; ownerId: string; cwd: string; text: string; prevTitle: string; emit: Emit;
}): Promise<void> {
  if (!p.text.trim()) return;
  // no auth (mock) → the snippet already stored IS the truncation fallback, so there is nothing to do
  const prov = resolveProvider(p.ownerId);
  if (prov.source === 'none') return;

  const title = await titleFor({
    sessionId: p.sessionId, ownerId: p.ownerId, cwd: p.cwd, text: p.text,
    maxChars: cfg.int('autoTitleMaxChars'), hasAuth: true,
    providerEnv: prov.env, providerModel: prov.model,
  });
  if (!title || title === p.prevTitle) return;

  // re-check: the user may have renamed the imported chat while the model was thinking
  const fresh = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, p.sessionId)).get();
  if (!fresh || fresh.title !== p.prevTitle) return;
  db.update(schema.chatSessions).set({ title }).where(eq(schema.chatSessions.id, p.sessionId)).run();
  p.emit('session:title', { sessionId: p.sessionId, title });
}
