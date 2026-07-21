import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { buildOptions, type SessionContext } from '../claude/config-layering.js';
import { resolveClaudeAuth } from '../auth/claude-token.js';
import { recordUsage } from '../usage/tracker.js';
import { io } from '../realtime/io.js';

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

function compilePrompt(name: string, description: string) {
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
  const ctx: SessionContext = {
    kind: 'user', ownerId: t.createdBy, cwd: t.path,
    model: 'claude-opus-4-8',
    // acceptEdits (not bypassPermissions): the always-allow canUseTool below authorizes every
    // tool, and bypass maps to --dangerously-skip-permissions which the CLI refuses under root.
    permissionMode: 'acceptEdits',
    plugins: [], // deterministic compile — no user plugins/skills in the loop
    authToken: resolveClaudeAuth(t.createdBy).token, // creator's token, else admin common, else env
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
  const q = query({ prompt: compilePrompt(t.name, t.description), options });
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
  // no resolvable token (creator's own, admin common, or env) — skip; nothing to authenticate with
  if (resolveClaudeAuth(t.createdBy).source === 'none') { setStatus(topicId, 'done', null); return; }

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
