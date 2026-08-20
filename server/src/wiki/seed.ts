// Seeding a brand-new wiki topic from something that already exists in the workspace, instead of
// from an upload. Three sources, all of which end up as ordinary files under the topic's raw/ dir —
// from there the normal compile turns them into wiki/ articles, so nothing downstream is special:
//   - session : one markdown transcript of a private chat or a room ("공통 세션")
//   - project : the project's own files (gitignore-aware, capped), copied in as sources
//   - blank   : nothing at all (제로베이스) — the base grows from conversations (see learn.ts)
import fs from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ensure } from '../lib/paths.js';
import { cfg } from '../lib/config-registry.js';
import { walkBundle } from '../lib/session-export.js';

export type SeedType = 'upload' | 'session' | 'project' | 'blank';
export interface Seed { type: SeedType; sessionId?: string; projectId?: string }

// A filename that is safe on every filesystem we run on and still readable (Korean kept).
export function slugify(s: string, fallback = 'untitled'): string {
  const out = String(s).normalize('NFC').replace(/[\x00-\x1f/\\:*?"<>|]/g, '').replace(/\s+/g, '-').replace(/^[.\-]+/, '').trim();
  return out.slice(0, 80) || fallback;
}

function textOf(content: any): string {
  const parts: string[] = [];
  if (typeof content?.text === 'string') parts.push(content.text);
  for (const b of Array.isArray(content?.blocks) ? content.blocks : []) {
    // tool calls are HOW the answer was produced, not knowledge — one line each keeps the shape
    // of the conversation without dragging in file dumps and diffs.
    if (b?.type === 'text' && typeof b.text === 'string' && !b.parentId) parts.push(b.text);
    else if (b?.type === 'tool_use') parts.push(`_(${String(b.name || 'tool')})_`);
  }
  return parts.join('\n\n').trim();
}

// One chat rendered as a readable markdown transcript. Team chat (chat=1) is included: in a room it
// is often where the actual decision was argued out.
export function renderTranscript(sessionId: string, title: string): string {
  const rows = db.select().from(schema.messages)
    .where(eq(schema.messages.sessionId, sessionId)).orderBy(asc(schema.messages.createdAt)).all();
  const out: string[] = [`# ${title}`, ''];
  for (const m of rows) {
    let content: any;
    try { content = JSON.parse(m.content); } catch { continue; }
    const body = textOf(content);
    if (!body) continue;
    const who = m.role === 'assistant' ? 'Claude' : (m.authorName || m.role);
    out.push(`## ${who}`, '', body, '');
  }
  return out.join('\n');
}

// Copy a project's files in as sources. gitignore-aware and capped (walkBundle) — a wiki seeded
// from a checkout must not drag in node_modules or a 2GB dataset.
function copyProject(projectDir: string, destDir: string): number {
  const { files } = walkBundle(
    projectDir, { exclude: new Set(), include: new Set() },
    cfg.int('wikiSeedMaxKB') * 1024, cfg.int('wikiSeedMaxFiles'),
  );
  let n = 0;
  for (const rel of files) {
    const src = path.join(projectDir, rel);
    const dest = path.join(destDir, rel);
    try { ensure(path.dirname(dest)); fs.copyFileSync(src, dest); n++; } catch { /* unreadable — skip */ }
  }
  return n;
}

// Materialize `seed` into <topicDir>/raw/. Returns a one-line human-readable summary ('' = nothing
// written). The caller has already checked that the requester may read the source.
export function applySeed(topicDir: string, seed: Seed): string {
  const rawDir = path.join(topicDir, 'raw');
  ensure(rawDir);
  if (seed.type === 'session' && seed.sessionId) {
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, seed.sessionId)).get();
    if (!s) return '';
    const dir = path.join(rawDir, 'sessions'); ensure(dir);
    const md = renderTranscript(s.id, s.title);
    fs.writeFileSync(path.join(dir, `${slugify(s.title, s.id)}.md`), md, 'utf8');
    return `session: ${s.title}`;
  }
  if (seed.type === 'project' && seed.projectId) {
    const p = db.select().from(schema.projects).where(eq(schema.projects.id, seed.projectId)).get();
    if (!p || !fs.existsSync(p.path)) return '';
    const dir = path.join(rawDir, 'project', slugify(p.name, p.id));
    const n = copyProject(p.path, dir);
    return `project: ${p.name} (${n} files)`;
  }
  return ''; // blank / upload — upload already moved its staged tree in
}
