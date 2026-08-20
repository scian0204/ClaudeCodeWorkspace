import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { buildOptions, type SessionContext } from '../claude/config-layering.js';
import { resolveProvider } from '../auth/provider.js';
import { cfg } from '../lib/config-registry.js';
import { recordUsage } from '../usage/tracker.js';
import { io } from '../realtime/io.js';
import { wikiPluginPaths } from './plugin.js';

// One compile per topic at a time. Guards against overlapping auto-compile + recompile.
const inflight = new Set<string>();

export function isCompiling(topicId: string) { return inflight.has(topicId); }

function getTopic(id: string) {
  return db.select().from(schema.wikiTopics).where(eq(schema.wikiTopics.id, id)).get();
}

function anyFiles(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (anyFiles(path.join(dir, e.name))) return true; }
    else return true;
  }
  return false;
}

function setStatus(topicId: string, status: string, error: string | null) {
  const patch: any = { compileStatus: status, compileError: error };
  if (status === 'done') patch.compiledAt = Date.now();
  db.update(schema.wikiTopics).set(patch).where(eq(schema.wikiTopics.id, topicId)).run();
  try { io?.emit('wiki:status', { topicId, status, compiledAt: patch.compiledAt ?? null, error }); } catch { /* io not ready */ }
}

// live compile heartbeat — DB-free, broadcast only (transient step text for the UI + server log)
function progress(topicId: string, step: string) {
  console.log(`[wiki:compile ${topicId}] ${step}`);
  try { io?.emit('wiki:progress', { topicId, step }); } catch { /* io not ready */ }
}
function briefInput(input: any): string {
  if (!input) return '';
  const p = input.file_path || input.path || input.pattern || input.command;
  if (p) return String(p).split('/').slice(-2).join('/');
  return JSON.stringify(input).slice(0, 60);
}

// Two compile shapes. 'wiki' synthesizes: merge, dedupe, one article per concept. 'minutes' does
// the OPPOSITE on purpose — one document per meeting, never merged, because "what did we decide on
// the 15th and when did it change" is the whole point of a minutes base; merging destroys history.
function compilePrompt(t: { name: string; description: string; kind: string }) {
  const { name, description } = t;
  if (t.kind === 'minutes') {
    return [
      `You are compiling MEETING MINUTES for the topic "${name}".`,
      description ? `Topic guidance from the admin: ${description}` : '',
      ``,
      `Sources live in ./raw/ — meeting notes (possibly messy, rambling and unordered), supporting material (slides, whiteboard photos — you are multimodal, open images with Read), and corrections. Your job:`,
      `1. Identify each distinct meeting: its date and title, from folder/file names (raw/meetings/2026-08-20*/, "0820 주간회의.md") or from the content itself. Notes + slides + corrections for the same meeting are ONE meeting.`,
      `2. Write ONE document per meeting at ./wiki/meetings/<YYYY-MM-DD>-<slug>.md: attendees (if known), agenda, a cleaned-up summary of the discussion (dedupe the rambling; keep who said what where it matters), decisions, and action items (owner + due date when stated). Fold corrections in and note that a correction was applied. NEVER merge two meetings into one document — per-meeting history is the point of this base.`,
      `3. Write ./wiki/decisions.md — the decision register: every decision with its date and a link to the meeting document it came from. When a later meeting reverses or changes an earlier decision, keep BOTH entries and mark the earlier one as superseded (say by which meeting).`,
      `4. Write ./wiki/actions.md — the action-item register: owner, due date, latest known status. A later meeting saying something got done updates the status HERE; the original meeting document stays as written.`,
      `5. Generate ./wiki/_index.md: meetings newest-first with a one-line summary each, plus links to the two registers.`,
      `6. Do NOT modify or delete anything in ./raw/ (immutable sources). Do NOT touch ./CLAUDE.md.`,
      `Write all files directly to disk. Keep going until ./wiki/ is complete, then output a one-line summary of what you produced.`,
    ].filter(Boolean).join('\n');
  }
  return [
    `You are compiling an LLM-Wiki knowledge base on the topic "${name}".`,
    description ? `Topic guidance from the admin: ${description}` : '',
    ``,
    `Sources live in ./raw/ (may be nested to any depth, any file type). Your job:`,
    `1. Read every source file under ./raw/, INCLUDING images (.png/.jpg/.jpeg/.gif/.webp/.bmp) — you are multimodal, so open images with the Read tool and treat diagrams, screenshots, charts and figures as first-class sources.`,
    `2. Synthesize the knowledge into clean, deduplicated articles under ./wiki/ — one .md file per concept/topic. Merge overlapping sources; resolve contradictions and note them. For each image, transcribe any visible text and describe the diagram/figure/screenshot in prose, folding it into the relevant article and citing the source image path (e.g. raw/dir/img.png) so the visual knowledge survives as text.`,
    `3. In each article, cross-link related articles using both an Obsidian link and a plain markdown link: [[article-name]] ([article-name](./article-name.md)). Where a claim rests on weak or single-source evidence, tag it with "(confidence: low|medium|high)".`,
    `4. Generate ./wiki/_index.md as the entry point: a hierarchical map (sections → article links) with a one-line summary per article.`,
    `5. Do NOT modify or delete anything in ./raw/ (immutable sources). Do NOT touch ./CLAUDE.md.`,
    `Write all files directly to disk. Keep going until ./wiki/ is complete, then output a one-line summary of what you produced.`,
  ].filter(Boolean).join('\n');
}

async function runCompile(t: NonNullable<ReturnType<typeof getTopic>>) {
  const prov = resolveProvider(t.createdBy); // creator's provider/token, else admin common, else env
  const ctx: SessionContext = {
    kind: 'user', ownerId: t.createdBy, cwd: t.path,
    model: cfg.str('defaultModel'),
    // acceptEdits (not bypassPermissions): the always-allow canUseTool below authorizes every
    // tool, and bypass maps to --dangerously-skip-permissions which the CLI refuses under root.
    permissionMode: 'acceptEdits',
    // deterministic compile: the bundled wiki plugin only, and only this topic's CLAUDE.md —
    // no workspace plugins, no operator settings layer (see wiki/plugin.ts)
    plugins: wikiPluginPaths(), settingSources: ['project'],
    authToken: '', providerEnv: prov.env, providerModel: prov.model,
  };
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const abort = new AbortController();
  const rawDir = path.resolve(t.path, 'raw');
  const options = buildOptions(ctx, {
    // auto-allow every tool EXCEPT writes into raw/ — originals are immutable sources
    canUseTool: async (name: string, input: any) => {
      if (/Edit|Write/.test(name)) {
        const p = input?.file_path || input?.path;
        if (p) {
          const abs = path.resolve(p.startsWith('/') ? p : path.join(t.path, p));
          if (abs === rawDir || abs.startsWith(rawDir + path.sep)) {
            return { behavior: 'deny' as const, message: 'raw/ is immutable — write compiled output under wiki/ instead' };
          }
        }
      }
      return { behavior: 'allow' as const, updatedInput: input };
    },
    abortController: abort,
  });
  const q = query({ prompt: compilePrompt(t), options });
  let inTok = 0, outTok = 0, cost = 0;
  for await (const msg of q as any) {
    // live progress so a compile never looks hung — each tool call / text line is a heartbeat
    if (msg?.type === 'assistant') {
      for (const b of msg.message?.content || []) {
        if (b.type === 'tool_use') progress(t.id, `${b.name}: ${briefInput(b.input)}`);
        else if (b.type === 'text' && b.text?.trim()) progress(t.id, b.text.trim().split('\n')[0].slice(0, 140));
      }
    } else if (msg?.type === 'result') {
      inTok = msg.usage?.input_tokens ?? inTok;
      outTok = msg.usage?.output_tokens ?? outTok;
      cost = msg.total_cost_usd ?? cost;
    }
  }
  recordUsage({ userId: t.createdBy, sessionId: null, roomId: null, inputTokens: inTok, outputTokens: outTok, costUsd: cost });
}

// Compile (or recompile) a topic: raw/ sources -> synthesized wiki/ articles + _index.md.
// Fire-and-forget; status flows to the DB + a 'wiki:status' socket broadcast.
export async function compileTopic(topicId: string): Promise<void> {
  if (inflight.has(topicId)) return;
  const t = getTopic(topicId); if (!t) return;
  const rawDir = path.join(t.path, 'raw');
  const wikiDir = path.join(t.path, 'wiki');
  if (!anyFiles(rawDir)) { setStatus(topicId, 'done', null); return; } // nothing to compile
  // no resolvable auth (creator's provider/token, admin common, or env) — skip; nothing to run with
  if (resolveProvider(t.createdBy).source === 'none') { setStatus(topicId, 'done', null); return; }

  inflight.add(topicId);
  setStatus(topicId, 'compiling', null);
  progress(topicId, '컴파일 시작 — 원본 읽는 중…');
  try {
    fs.rmSync(wikiDir, { recursive: true, force: true }); // fresh articles each compile
    fs.mkdirSync(wikiDir, { recursive: true });
    await runCompile(t);
    setStatus(topicId, 'done', null);
  } catch (e: any) {
    setStatus(topicId, 'error', String(e?.message || e).slice(0, 500));
  } finally {
    inflight.delete(topicId);
  }
}
