// Growing a knowledge base from the conversations held against it.
//
// After a turn finishes in a thread bound to a wiki topic — the topic's own query thread, or an
// ordinary session that linked the topic as reference — one short, tool-less model call reads the
// exchange and decides whether it holds knowledge worth keeping. The MODEL makes that call; the
// topic's `autoLearn` mode only decides what happens to a yes:
//   'off'  — never runs
//   'ask'  — the article is parked as a proposal and a human presses 추가/무시
//   'auto' — the article is written straight in
//
// Where it is written matters. Every compile WIPES wiki/ and regenerates it from raw/, so a note
// that lived only in wiki/ would disappear at the next recompile. The durable copy therefore goes
// to raw/conversations/ (an ordinary source, folded into proper articles on the next compile) and a
// mirror goes to wiki/conversations/ so the knowledge is answerable immediately, linked from
// _index.md — which is the first thing a query reads.
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { ensure } from '../lib/paths.js';
import { cfg } from '../lib/config-registry.js';
import { recordUsage } from '../usage/tracker.js';
import { buildOptions, type SessionContext } from '../claude/config-layering.js';
import { isCompiling } from './compile.js';
import { slugify } from './seed.js';

type Emit = (event: string, payload: any) => void;
type Topic = typeof schema.wikiTopics.$inferSelect;

const INDEX_SECTION = '## 대화에서 추가된 지식';

export interface Note { title: string; slug: string; content: string; sessionId: string }

function getTopic(id: string): Topic | undefined {
  return db.select().from(schema.wikiTopics).where(eq(schema.wikiTopics.id, id)).get();
}

// Which topic (if any) a finished turn should feed. A wiki query thread feeds its own topic; an
// ordinary session feeds the topic it linked — the same knowledge is worth keeping either way.
export function learnTargetTopic(s: { wikiTopicId: string | null; wikiRefId: string | null }): Topic | undefined {
  const id = s.wikiTopicId || s.wikiRefId;
  return id ? getTopic(id) : undefined;
}

// ── writing ──────────────────────────────────────────────────────────────────

// Append the article to wiki/_index.md under its own section, creating index + section on demand.
// A zero-base topic has no index at all until the first note lands here.
function linkInIndex(topicDir: string, title: string, file: string) {
  const idx = path.join(topicDir, 'wiki', '_index.md');
  const line = `- [${title}](./conversations/${file})`;
  let text = '';
  try { text = fs.readFileSync(idx, 'utf8'); } catch { /* first note — index does not exist yet */ }
  if (text.includes(line)) return;
  if (!text.trim()) text = '# _index\n';
  if (!text.includes(INDEX_SECTION)) text += `\n${INDEX_SECTION}\n`;
  text = text.replace(INDEX_SECTION, `${INDEX_SECTION}\n${line}`);
  ensure(path.dirname(idx));
  fs.writeFileSync(idx, text, 'utf8');
}

// Write one note into a topic. Same bytes twice on purpose (see the file header): raw/ is the copy
// that survives a recompile, wiki/ is the copy a query can answer from right now.
export function applyKnowledge(topic: Topic, note: Note): string {
  const stem = slugify(note.slug || note.title, 'note');
  const file = `${stem}.md`;
  const body = [
    `# ${note.title}`,
    '',
    `<sub>대화에서 추가됨 · ${new Date().toISOString().slice(0, 10)}</sub>`,
    '',
    note.content.trim(),
    '',
  ].join('\n');
  for (const dir of ['raw', 'wiki']) {
    const full = path.join(topic.path, dir, 'conversations', file);
    ensure(path.dirname(full));
    fs.writeFileSync(full, body, 'utf8');
  }
  linkInIndex(topic.path, note.title, file);
  return file;
}

// ── deciding ─────────────────────────────────────────────────────────────────

// Text of the last user prompt + the answer it got, which is the exchange just finished.
function lastExchange(sessionId: string): { question: string; answer: string } {
  const rows = db.select().from(schema.messages)
    .where(and(eq(schema.messages.sessionId, sessionId), eq(schema.messages.chat, 0)))
    .orderBy(desc(schema.messages.createdAt)).limit(6).all();
  let question = '', answer = '';
  for (const m of rows) { // newest first
    let c: any; try { c = JSON.parse(m.content); } catch { continue; }
    if (!answer && m.role === 'assistant') {
      answer = (Array.isArray(c?.blocks) ? c.blocks : [])
        .filter((b: any) => b?.type === 'text' && !b.parentId).map((b: any) => b.text).join('\n').trim();
    } else if (answer && !question && m.role === 'user') {
      question = String(c?.text || '').trim();
    }
    if (question && answer) break;
  }
  return { question, answer };
}

function existingIndex(topicDir: string): string {
  try { return fs.readFileSync(path.join(topicDir, 'wiki', '_index.md'), 'utf8').slice(0, 4000); }
  catch { return '(아직 인덱스 없음 — 이 위키는 비어 있습니다)'; }
}

const PROMPT = (t: Topic, index: string, question: string, answer: string, maxChars: number) =>
`You maintain the LLM-Wiki knowledge base "${t.name}".${t.description ? ` Topic guidance: ${t.description}` : ''}

Below is one exchange from a conversation held against this wiki. Decide whether it contains
DURABLE knowledge that belongs in the base — a fact, decision, procedure, definition or correction
that a future reader would benefit from. Do NOT add: small talk, questions with no answer, anything
already covered by the index below, restatements of what the wiki already says, or transient
chatter about the tool itself.

Existing index of the base:
"""
${index}
"""

The exchange:
[user]
"""
${question.slice(0, 6000)}
"""
[assistant]
"""
${answer.slice(0, 12000)}
"""

Reply with ONE JSON object and nothing else — no prose, no markdown fence:
{"add": false}
or
{"add": true, "title": "<short article title, in the language of the exchange>",
 "slug": "<lowercase-ascii-hyphen-filename>",
 "content": "<the article itself in markdown, at most ${maxChars} characters — the knowledge only, written as reference prose, not as a chat log>"}

Be conservative: when in doubt, answer {"add": false}. Do not use any tools.`;

// Tolerant JSON read — a small model likes to wrap the object in a fence or add a sentence.
export function parseDecision(out: string): { add: boolean; title?: string; slug?: string; content?: string } {
  const s = String(out).replace(/```(?:json)?/gi, '').trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return { add: false };
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return { add: false }; }
}

async function decide(a: {
  topic: Topic; sessionId: string; userId: string; question: string; answer: string;
  providerEnv?: Record<string, string>; providerModel?: string;
}) {
  const maxChars = cfg.int('wikiLearnMaxKB') * 1024;
  const ctx: SessionContext = {
    kind: 'user', ownerId: a.userId, cwd: a.topic.path, model: cfg.str('wikiLearnModel'),
    // one JSON answer with every tool denied: no plugin has anything to add, and the operator's
    // settings layer could only distort the decision
    permissionMode: 'default', plugins: [], settingSources: ['project'], authToken: '',
    providerEnv: a.providerEnv, providerModel: a.providerModel,
  };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), cfg.int('wikiLearnTimeoutMs'));
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const options = buildOptions(ctx, {
      canUseTool: async () => ({ behavior: 'deny', message: 'knowledge extraction' }),
      abortController: abort,
    });
    const q: any = query({
      prompt: PROMPT(a.topic, existingIndex(a.topic.path), a.question, a.answer, maxChars),
      options,
    });
    let out = '';
    for await (const msg of q) {
      if (abort.signal.aborted) break;
      if (msg?.type === 'assistant') {
        for (const b of msg.message?.content || []) if (b.type === 'text') out += b.text;
      } else if (msg?.type === 'result') {
        recordUsage({
          userId: a.userId, sessionId: a.sessionId, roomId: null,
          inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0,
          costUsd: msg.total_cost_usd ?? 0,
        });
        break;
      }
    }
    const d = parseDecision(out);
    if (!d.add || !String(d.content || '').trim() || !String(d.title || '').trim()) return null;
    return {
      title: String(d.title).slice(0, 120),
      slug: String(d.slug || d.title),
      content: String(d.content).slice(0, maxChars),
    };
  } finally {
    clearTimeout(timer);
    try { abort.abort(); } catch { /* noop */ }
  }
}

// ── the hook ─────────────────────────────────────────────────────────────────

// Best-effort and off the turn's critical path: the caller fires and forgets. A failure here must
// never look like a failed turn, so nothing is thrown out of it.
export async function maybeWikiLearn(p: {
  sessionId: string; author: { id: string; name: string }; emit: Emit;
  hasAuth: boolean; providerEnv?: Record<string, string>; providerModel?: string;
}): Promise<void> {
  if (!cfg.bool('wikiAutoLearnEnabled') || !p.hasAuth) return;
  const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, p.sessionId)).get();
  if (!s) return;
  const topic = learnTargetTopic(s);
  if (!topic || topic.autoLearn === 'off') return;
  if (isCompiling(topic.id)) return; // a compile is about to rewrite wiki/ — don't race it

  const { question, answer } = lastExchange(p.sessionId);
  if (!question || !answer) return;

  const note = await decide({
    topic, sessionId: p.sessionId, userId: p.author.id, question, answer,
    providerEnv: p.providerEnv, providerModel: p.providerModel,
  });
  if (!note) return;

  if (topic.autoLearn === 'auto') {
    applyKnowledge(topic, { ...note, sessionId: p.sessionId });
    p.emit('wiki:learned', { sessionId: p.sessionId, topicId: topic.id, topicName: topic.name, title: note.title });
    return;
  }
  const row = {
    id: newId(), topicId: topic.id, sessionId: p.sessionId, title: note.title, slug: note.slug,
    content: note.content, status: 'pending', createdBy: p.author.id, createdAt: Date.now(),
  };
  db.insert(schema.wikiProposals).values(row).run();
  p.emit('wiki:proposal', { sessionId: p.sessionId, proposal: { ...row, topicName: topic.name } });
}

// ── proposals ────────────────────────────────────────────────────────────────

export function pendingProposals(sessionId: string) {
  const rows = db.select().from(schema.wikiProposals)
    .where(and(eq(schema.wikiProposals.sessionId, sessionId), eq(schema.wikiProposals.status, 'pending')))
    .orderBy(schema.wikiProposals.createdAt).all();
  return rows.map((r) => ({ ...r, topicName: getTopic(r.topicId)?.name || '' }));
}

export function getProposal(id: string) {
  return db.select().from(schema.wikiProposals).where(eq(schema.wikiProposals.id, id)).get();
}

// Accept a parked proposal: write the files, mark it applied. Rejecting is the same minus the write.
export function decideProposal(id: string, accept: boolean): { ok: boolean; topicId?: string } {
  const row = getProposal(id);
  if (!row || row.status !== 'pending') return { ok: false };
  if (accept) {
    const topic = getTopic(row.topicId);
    if (!topic) return { ok: false };
    applyKnowledge(topic, { title: row.title, slug: row.slug, content: row.content, sessionId: row.sessionId });
  }
  db.update(schema.wikiProposals).set({ status: accept ? 'applied' : 'rejected' })
    .where(eq(schema.wikiProposals.id, id)).run();
  return { ok: true, topicId: row.topicId };
}
