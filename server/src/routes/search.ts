// Workspace-wide unified search. ONE endpoint that sweeps every internal surface the caller may
// already read — private chats, room chats they belong to, wiki topics + their compiled files,
// DM/group messages, projects, PR-review sessions, the user directory — and returns a flat,
// type-tagged hit list the client groups.
//
// Visibility is NOT re-invented here: each collector reuses the exact gate its own feature route
// uses (chat_sessions → canViewChat semantics from routes/sessions, rooms.isMember, projects
// canAccess, review.listReviewSessionsForUser, dm membership). DMs stay membership-only even for
// admins, matching rooms/dm.ts — an admin can promote a group channel but never read one they're
// not in.
//
// ponytail: SQL `LIKE '%q%'` scan (no FTS5 index). A team workspace's message table is small enough
// that SQLite's C-side scan stops at the per-type cap; swap in an FTS5 virtual table + triggers if
// message volume ever makes this slow.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, type AuthUser } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import * as rooms from '../rooms/manager.js';
import * as dm from '../rooms/dm.js';
import { listReviewSessionsForUser } from '../review/manager.js';

const MIN_CHARS = 2;   // below this every query matches everything — not worth a table scan
const SNIPPET_W = 180; // excerpt width; purely cosmetic, no reason to make it tunable

export type HitType = 'chat' | 'session' | 'room' | 'dm' | 'channel' | 'project' | 'wiki' | 'wikiFile' | 'review' | 'user';

// Where clicking a hit takes the client. Mirrors the store's existing openers (openPrivate /
// openRoom / openWiki / openReview / openChannel) plus two explorer targets (project, wikiFile).
export interface HitNav {
  kind: 'private' | 'room' | 'wiki' | 'review' | 'channel' | 'project' | 'wikiFile' | 'user';
  sessionId?: string; roomId?: string; topicId?: string; reviewId?: string;
  channelId?: string; projectId?: string; userId?: string;
  messageId?: string;                       // chat hits: scroll to + highlight this message
  dir?: 'raw' | 'wiki'; filePath?: string;  // wikiFile hits: which file the explorer opens
}
export interface Hit {
  type: HitType;
  id: string;            // React key — unique per hit
  title: string;
  subtitle?: string;     // where it lives (session title / channel / repo / project path)
  snippet?: string;      // matched text with a bit of context
  ts?: number;
  nav: HitNav;
}

const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|csv|tsv|ts|tsx|js|jsx|py|go|rs|java|kt|c|h|cpp|sh|sql|html|css)$/i;

// SQLite LIKE has no default escape char, so wildcards typed by the user would silently widen the
// match. Escape them and declare ESCAPE '\' on the comparison.
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const likeExpr = (col: any, q: string) => sql`${col} LIKE ${`%${escapeLike(q)}%`} ESCAPE '\\'`;

const hay = (s: string) => s.toLowerCase();
const has = (text: string | null | undefined, needle: string) => !!text && hay(text).includes(needle);

// One-line excerpt centred on the match. Collapses whitespace so a code block doesn't blow up the row.
export function snippet(text: string, needle: string, width = SNIPPET_W): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const i = hay(flat).indexOf(needle);
  if (i < 0) return flat.slice(0, width) + (flat.length > width ? '…' : '');
  const start = Math.max(0, i - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '');
}

// Flatten a stored message's content JSON into searchable text: the user's prompt, Claude's text
// blocks, and each tool call's name + input + output (so "which turn touched this file" works).
// Capped per part — a 5MB tool output has no business being scanned for a snippet.
const PART_CAP = 4000;
export function messageText(content: any): string {
  if (!content || typeof content !== 'object') return '';
  const parts: string[] = [];
  if (typeof content.text === 'string') parts.push(content.text);
  for (const b of Array.isArray(content.blocks) ? content.blocks : []) {
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text.slice(0, PART_CAP));
    else if (b?.type === 'tool_use') {
      parts.push(String(b.name || ''));
      try { parts.push(JSON.stringify(b.input ?? '').slice(0, PART_CAP)); } catch { /* unserializable */ }
      if (typeof b.output === 'string') parts.push(b.output.slice(0, PART_CAP));
    }
  }
  return parts.join('\n');
}

type Chat = typeof schema.chatSessions.$inferSelect;
interface ChatCtx { row: Chat; nav: HitNav; label: string }

// Every chat session this user may VIEW, with the label + navigation each hit inside it needs.
// Same rules as routes/sessions.ts canViewChat, resolved in bulk (one pass) so the message query
// can be constrained to those ids instead of filtering after the fact.
function visibleChats(u: AuthUser): Map<string, ChatCtx> {
  const out = new Map<string, ChatCtx>();
  const isAdmin = u.role === 'admin';
  const roomById = new Map(db.select().from(schema.rooms).all().map((r) => [r.id, r]));
  const topicById = new Map(db.select().from(schema.wikiTopics).all().map((t) => [t.id, t]));
  const reviewByChat = new Map(db.select().from(schema.reviewSessions).all().map((r) => [r.chatSessionId, r]));

  for (const row of db.select().from(schema.chatSessions).all()) {
    if (row.kind === 'room') {
      const room = roomById.get(row.roomId || '');
      if (!room) continue;
      if (!isAdmin && !rooms.isMember(room.id, u.id)) continue;
      out.set(row.id, { row, nav: { kind: 'room', roomId: room.id }, label: room.name });
    } else if (row.kind === 'review') {
      const rv = reviewByChat.get(row.id);
      if (!rv) continue;
      if (!isAdmin && rv.authorUserId !== u.id) continue;
      out.set(row.id, { row, nav: { kind: 'review', reviewId: rv.id }, label: `#${rv.prNumber} ${rv.prTitle}` });
    } else {
      if (row.ownerId !== u.id && !isAdmin) continue;
      if (row.wikiTopicId) {
        const topic = topicById.get(row.wikiTopicId);
        out.set(row.id, { row, nav: { kind: 'wiki', topicId: row.wikiTopicId }, label: topic?.name || row.title });
      } else {
        out.set(row.id, { row, nav: { kind: 'private', sessionId: row.id }, label: row.title });
      }
    }
  }
  return out;
}

// Projects the caller may open — same rule as routes/projects.ts canAccess.
function visibleProjects(u: AuthUser) {
  const isAdmin = u.role === 'admin';
  return db.select().from(schema.projects).all().filter((p) => {
    if (isAdmin || p.scope === 'common') return true;
    if (p.scope === 'user') return p.ownerId === u.id;
    if (p.scope === 'room') return rooms.isMember(p.ownerId!, u.id);
    return false;
  });
}

// Collect text-file paths under a wiki topic dir, bounded by a shared scan budget so a huge raw/
// import can't turn one search into a full disk crawl.
function scanTopicFiles(root: string, budget: { left: number }): string[] {
  const out: string[] = [];
  const walk = (dir: string, base: string, depth: number) => {
    if (budget.left <= 0 || depth > 8) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (budget.left <= 0) return;
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel, depth + 1);
      else if (e.isFile() && TEXT_EXT.test(e.name)) { out.push(rel); budget.left--; }
    }
  };
  walk(root, '', 0);
  return out;
}

export async function searchRoutes(app: FastifyInstance) {
  // GET /api/search?q=<term>[&types=chat,dm,…]
  app.get('/api/search', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('searchEnabled')) return reply.code(404).send({ error: 'search disabled' });

    const q = String((req.query as any).q || '').trim();
    if (q.length < MIN_CHARS) return { q, hits: [], minChars: MIN_CHARS };
    const needle = hay(q);
    const perType = cfg.int('searchMaxPerType');
    const wantRaw = String((req.query as any).types || '').split(',').map((s) => s.trim()).filter(Boolean);
    const want = (t: HitType) => wantRaw.length === 0 || wantRaw.includes(t);

    const hits: Hit[] = [];
    const room = (t: HitType) => hits.reduce((n, h) => n + (h.type === t ? 1 : 0), 0) < perType;
    const chats = visibleChats(u);

    // ── private chat titles ──
    if (want('session')) {
      const rows = db.select().from(schema.chatSessions)
        .where(and(eq(schema.chatSessions.kind, 'private'), isNull(schema.chatSessions.wikiTopicId),
          likeExpr(schema.chatSessions.title, q)))
        .orderBy(desc(schema.chatSessions.updatedAt)).limit(perType * 4).all();
      for (const s of rows) {
        if (!room('session')) break;
        const v = chats.get(s.id); if (!v) continue; // someone else's private thread (admin scan)
        hits.push({ type: 'session', id: `session:${s.id}`, title: s.title, ts: s.updatedAt, nav: v.nav });
      }
    }

    // ── room names ──
    if (want('room')) {
      for (const r of rooms.listRoomsForUser(u)) {
        if (!room('room')) break;
        if (!has(r.name, needle)) continue;
        hits.push({
          type: 'room', id: `room:${r.id}`, title: r.name, ts: r.createdAt,
          subtitle: r.members.map((m) => m.displayName).join(', '),
          nav: { kind: 'room', roomId: r.id },
        });
      }
    }

    // ── chat messages (private + room + wiki thread + review chats) ──
    if (want('chat') && chats.size) {
      // An admin sees every session, so skip the id list entirely — it would otherwise blow past
      // SQLite's bound-parameter ceiling on a big workspace.
      const where = u.role === 'admin'
        ? likeExpr(schema.messages.content, q)
        : and(inArray(schema.messages.sessionId, [...chats.keys()]), likeExpr(schema.messages.content, q));
      const rows = db.select().from(schema.messages).where(where)
        .orderBy(desc(schema.messages.createdAt)).limit(perType * 3).all();
      for (const m of rows) {
        if (!room('chat')) break;
        const v = chats.get(m.sessionId); if (!v) continue;
        let text = '';
        try { text = messageText(JSON.parse(m.content)); } catch { continue; }
        if (!has(text, needle)) continue; // matched only in the JSON scaffolding (keys/ids) — not a real hit
        hits.push({
          type: 'chat', id: `chat:${m.id}`, title: v.label,
          subtitle: m.authorName || (m.role === 'assistant' ? 'Claude' : m.role),
          snippet: snippet(text, needle), ts: m.createdAt,
          nav: { ...v.nav, messageId: m.id },
        });
      }
    }

    // ── DM / group chat (membership-only, admins included; off with the dmEnabled flag) ──
    if (cfg.bool('dmEnabled')) {
      const channels = dm.listChannels(u.id);
      const label = (c: (typeof channels)[number]) =>
        c.kind === 'group' ? (c.name || 'Group') : (c.members.find((m) => m.userId !== u.id)?.displayName || 'DM');
      if (want('channel')) {
        for (const c of channels) {
          if (!room('channel')) break;
          if (!has(c.name, needle)) continue;
          hits.push({
            type: 'channel', id: `channel:${c.id}`, title: label(c), ts: c.lastMessage?.createdAt ?? c.createdAt,
            subtitle: c.members.map((m) => m.displayName).join(', '),
            nav: { kind: 'channel', channelId: c.id },
          });
        }
      }
      if (want('dm') && channels.length) {
        const byId = new Map(channels.map((c) => [c.id, c]));
        const names = new Map(db.select().from(schema.users).all().map((x) => [x.id, x.displayName]));
        const rows = db.select().from(schema.dmMessages)
          .where(and(inArray(schema.dmMessages.channelId, [...byId.keys()]), likeExpr(schema.dmMessages.text, q)))
          .orderBy(desc(schema.dmMessages.createdAt)).limit(perType).all();
        for (const m of rows) {
          const c = byId.get(m.channelId)!;
          hits.push({
            type: 'dm', id: `dm:${m.id}`, title: label(c), subtitle: names.get(m.userId) || '',
            snippet: snippet(m.text, needle), ts: m.createdAt,
            nav: { kind: 'channel', channelId: m.channelId },
          });
        }
      }
    }

    // ── projects (name / path) ──
    if (want('project')) {
      for (const p of visibleProjects(u)) {
        if (!room('project')) break;
        if (!has(p.name, needle) && !has(p.path, needle)) continue;
        hits.push({
          type: 'project', id: `project:${p.id}`, title: p.name, subtitle: p.path, ts: p.createdAt,
          nav: { kind: 'project', projectId: p.id },
        });
      }
    }

    // ── wiki topics + their knowledge files (readable by any authed user, per routes/wiki.ts) ──
    const topics = db.select().from(schema.wikiTopics).orderBy(desc(schema.wikiTopics.createdAt)).all();
    if (want('wiki')) {
      for (const t of topics) {
        if (!room('wiki')) break;
        if (!has(t.name, needle) && !has(t.description, needle)) continue;
        hits.push({
          type: 'wiki', id: `wiki:${t.id}`, title: t.name, ts: t.createdAt,
          snippet: has(t.description, needle) ? snippet(t.description, needle) : undefined,
          nav: { kind: 'wiki', topicId: t.id },
        });
      }
    }
    if (want('wikiFile')) {
      const budget = { left: cfg.int('searchScanMaxFiles') };
      const maxBytes = cfg.int('searchFileMaxKB') * 1024;
      scan: for (const t of topics) {
        for (const dir of ['wiki', 'raw'] as const) {
          const root = path.join(t.path, dir);
          for (const rel of scanTopicFiles(root, budget)) {
            if (!room('wikiFile')) break scan;
            let text = '';
            try {
              const full = path.join(root, rel);
              // Oversized file: match on the path only, never slurp it into memory.
              if (fs.statSync(full).size <= maxBytes) text = fs.readFileSync(full, 'utf8');
            } catch { continue; }
            if (!has(text, needle) && !has(rel, needle)) continue;
            hits.push({
              type: 'wikiFile', id: `wikiFile:${t.id}:${dir}:${rel}`, title: rel,
              subtitle: `${t.name} · ${dir}/`,
              snippet: has(text, needle) ? snippet(text, needle) : undefined,
              nav: { kind: 'wikiFile', topicId: t.id, dir, filePath: rel },
            });
          }
        }
      }
    }

    // ── PR review sessions ──
    if (want('review')) {
      for (const s of listReviewSessionsForUser(u)) {
        if (!room('review')) break;
        const blob = `#${s.prNumber} ${s.prTitle} ${s.repoName} ${s.authorLogin} ${s.verdictSummary || ''}`;
        if (!has(blob, needle)) continue;
        hits.push({
          type: 'review', id: `review:${s.id}`, title: `#${s.prNumber} ${s.prTitle}`,
          subtitle: `${s.repoName} · ${s.authorLogin}`,
          snippet: has(s.verdictSummary, needle) ? snippet(s.verdictSummary!, needle) : undefined,
          ts: s.updatedAt, nav: { kind: 'review', reviewId: s.id },
        });
      }
    }

    // ── people (same directory the invite / DM pickers use) ──
    if (want('user')) {
      const rows = db.select().from(schema.users).all()
        .filter((x) => x.id !== u.id && (has(x.displayName, needle) || has(x.username, needle)))
        .slice(0, perType);
      for (const x of rows) {
        hits.push({
          type: 'user', id: `user:${x.id}`, title: x.displayName, subtitle: `@${x.username}`,
          nav: { kind: 'user', userId: x.id },
        });
      }
    }

    return { q, hits, minChars: MIN_CHARS };
  });
}
