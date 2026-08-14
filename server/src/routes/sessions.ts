import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../auth/index.js';
import { newId } from '../lib/ids.js';
import { probeCommands, probeUsage, cwdFor } from '../claude/session-manager.js';
import { resolveAgents } from '../claude/team-agents.js';
import { encodeSlug, rewriteCwd } from '../lib/session-import.js';
import { DEFAULT_TITLE, retitleSession } from '../claude/auto-title.js';
import { emitToUser } from '../realtime/io.js';
import { reviewRoleForChat } from '../review/manager.js';
import { cfg } from '../lib/config-registry.js';
import { paths, ensure } from '../lib/paths.js';
import { safeBase, isBareBasename, contentTypeFor, IMAGE_MIME } from '../lib/attachments.js';
import * as rooms from '../rooms/manager.js';
import type { AuthUser } from '../auth/index.js';
import { POOL_OWN, getPool } from '../auth/token-pool.js';

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

function loadMessages(sessionId: string) {
  return db.select().from(schema.messages).where(eq(schema.messages.sessionId, sessionId))
    .orderBy(schema.messages.createdAt).all()
    .map((m) => ({ ...m, content: JSON.parse(m.content) }));
}

type Chat = typeof schema.chatSessions.$inferSelect;
// Can this user VIEW the chat? private → owner/admin; review → admin or the PR author (read-only);
// room → unchanged (membership is gated on the room endpoints).
function canViewChat(u: AuthUser, s: Chat): boolean {
  if (s.kind === 'private') return s.ownerId === u.id || u.role === 'admin';
  if (s.kind === 'review') return !!reviewRoleForChat(s.id, u);
  return true;
}
// Can this user MUTATE the chat (title/model/mode, edit/delete messages)? review → admin only
// (the PR author is read-only).
function canEditChat(u: AuthUser, s: Chat): boolean {
  if (s.kind === 'private') return s.ownerId === u.id || u.role === 'admin';
  if (s.kind === 'review') return u.role === 'admin';
  return true;
}
// Attachment WRITE access mirrors the socket `chat:send` gate (realtime/io.ts access()): only someone
// who can actually send a turn may stage files for it. private → owner/admin; review → admin (PR author
// is read-only); room → admin or a member. Deliberately checks room membership (stronger than
// canEditChat, which leans on chatSessionId obscurity) because these endpoints write to disk.
function canWriteSession(u: AuthUser, s: Chat): boolean {
  if (s.kind === 'room') return u.role === 'admin' || rooms.isMember(s.roomId!, u.id);
  if (s.kind === 'review') return u.role === 'admin';
  return s.ownerId === u.id || u.role === 'admin';
}
// Attachment READ access. Like canViewChat for private/review (owner/admin, resp. the read-only PR
// author keep their view), but rooms require membership — canViewChat returns `true` for any room,
// which is too loose when the bytes actually leave the server. Mirrors canWriteSession's room gate.
function canViewAttachment(u: AuthUser, s: Chat): boolean {
  if (s.kind === 'room') return u.role === 'admin' || rooms.isMember(s.roomId!, u.id);
  return canViewChat(u, s);
}

const getChat = (id: string) => db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();

// per-session attachment dir (owner = roomId for rooms, else ownerId), created on demand.
function attachDir(s: Chat): string {
  const kind = s.kind === 'room' ? 'room' : 'user';
  const dir = paths.attachments(kind, kind === 'room' ? s.roomId! : s.ownerId, s.id);
  ensure(dir);
  return dir;
}
// Write `buf` without ever overwriting: on collision suffix `-2`, `-3`, … before the extension.
// Atomic exclusive create (flag 'wx') in a retry loop closes the existsSync→write TOCTOU (two
// concurrent uploads racing the same name). Returns the basename actually written. Collisions are
// bounded by the files already in `dir` (≤ attachmentMaxCount), so the loop always terminates.
function writeUnique(dir: string, base: string, buf: Buffer): string {
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${stem}-${i}${ext}`;
    try { fs.writeFileSync(path.join(dir, name), buf, { flag: 'wx' }); return name; }
    catch (e: any) { if (e?.code !== 'EEXIST') throw e; }
  }
}

export async function sessionRoutes(app: FastifyInstance) {
  // list private sessions for the current user
  app.get('/api/sessions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const rows = db.select().from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.kind, 'private'), eq(schema.chatSessions.ownerId, u.id),
        isNull(schema.chatSessions.wikiTopicId)))
      .orderBy(desc(schema.chatSessions.updatedAt)).all();
    return { sessions: rows };
  });

  app.post('/api/sessions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { title, projectId } = (req.body || {}) as any;
    const now = Date.now();
    const row = {
      id: newId(), ownerId: u.id, kind: 'private', roomId: null,
      title: title ? String(title) : DEFAULT_TITLE, projectId: projectId ? String(projectId) : null,
      claudeSessionId: null, model: cfg.str('defaultModel'), effort: cfg.str('defaultEffort'),
      permissionMode: 'default', createdAt: now, updatedAt: now,
    };
    db.insert(schema.chatSessions).values(row).run();
    return { session: row };
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canViewChat(u, s)) return reply.code(403).send({ error: 'forbidden' });
    return { session: s, messages: loadMessages(id) };
  });

  app.get('/api/sessions/:id/messages', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canViewChat(u, s)) return reply.code(403).send({ error: 'forbidden' });
    return { messages: loadMessages(id) };
  });

  // real slash commands / skills / agents the CLI exposes for this session (built-in + plugins)
  app.get('/api/sessions/:id/commands', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canViewChat(u, s)) return reply.code(403).send({ error: 'forbidden' });
    return { commands: await probeCommands(id, u.id) };
  });

  // context-window usage + claude.ai plan rate limits (5h / weekly / per-model) for this session
  app.get('/api/sessions/:id/usage', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canViewChat(u, s)) return reply.code(403).send({ error: 'forbidden' });
    // ?fresh=1 (the popover's refresh button) bypasses the probe cache and re-asks the CLI
    return { usage: await probeUsage(id, u.id, { fresh: (req.query as any)?.fresh === '1' }) };
  });

  // ── session export: the reverse of /api/import/sessions ──
  // Hands back the CLI's own transcript so the user can resume the session in a local Claude Code.
  // ?cwd=<localAbsPath> rewrites each line's `cwd` to the user's local project path (the CLI matches
  // transcripts against the runtime cwd, so without it resume won't list the session). The value is
  // used ONLY as a string for rewriteCwd/encodeSlug — it never touches this server's filesystem.
  app.get('/api/sessions/:id/export', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('sessionExportEnabled')) return reply.code(403).send({ error: 'session export is disabled' });
    const { id } = req.params as any;
    const s = getChat(id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    // private-only, owner/admin: transcripts carry full tool output (terminal echoes and all), so the
    // gate is deliberately tighter than canViewChat's room case.
    if (s.kind !== 'private' || !(s.ownerId === u.id || u.role === 'admin')) return reply.code(403).send({ error: 'forbidden' });
    if (!s.claudeSessionId) return reply.code(400).send({ error: 'nothing to export — the session has no CLI transcript yet' });
    const serverCwd = path.resolve(await cwdFor(s));
    const file = path.join(paths.userClaude(s.ownerId), 'projects', encodeSlug(serverCwd), `${s.claudeSessionId}.jsonl`);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: 'transcript file not found (cleaned up or never written)' });
    const localCwd = String((req.query as any)?.cwd || '').trim();
    let lines = fs.readFileSync(file, 'utf8').split('\n');
    if (localCwd) lines = lines.map((l) => rewriteCwd(l, localCwd));
    // carry the workspace title into the CLI's resume picker (same line shape the importer accepts)
    if (s.title && s.title !== DEFAULT_TITLE && !lines.some((l) => l.includes('"custom-title"'))) {
      lines.unshift(JSON.stringify({ type: 'custom-title', customTitle: s.title, sessionId: s.claudeSessionId }));
    }
    const jsonl = lines.join('\n');
    return {
      uuid: s.claudeSessionId, title: s.title, jsonl,
      slug: encodeSlug(localCwd || serverCwd),
      lineCount: lines.filter((l) => l.trim()).length,
    };
  });

  // ── prompt attachments (uploaded files / pasted screenshots) ──
  // Files are staged under <ownerProjectsDir>/.attachments/<sessionId>/ (an allowed root) and their
  // absolute paths get prepended to the turn's prompt so the agent Reads them. See rooms/queue +
  // claude/session-manager (runTurn) for how a name → absolute path reaches the prompt.
  app.post('/api/sessions/:id/attachments', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const s = getChat((req.params as any).id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canWriteSession(u, s)) return reply.code(403).send({ error: 'forbidden' });
    const maxMB = cfg.int('attachmentMaxMB');    // must stay ≤ uploadMaxMB (global multipart cap) to apply
    const maxCount = cfg.int('attachmentMaxCount');
    const dir = attachDir(s);
    const existing = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
    const out: { name: string; size: number; isImage: boolean }[] = [];
    const written: string[] = []; // absolute paths written THIS request — removed if a later part errors
    const cleanup = () => { for (const p of written) { try { fs.rmSync(p, { force: true }); } catch { /* noop */ } } };
    try {
      // uploadFiles posts ONE file per request; accept multiple parts defensively. fileSize caps each
      // part at the streaming layer (throws on overflow); maxCount bounds the total per session.
      for await (const part of (req as any).parts({ limits: { fileSize: maxMB * 1024 * 1024 } })) {
        if (part.type !== 'file') continue;
        if (existing + out.length >= maxCount) { part.file.resume(); cleanup(); return reply.code(400).send({ error: `too many attachments (max ${maxCount})` }); }
        let buf: Buffer;
        try { buf = await part.toBuffer(); } // fileSize limit throws on overflow
        catch { cleanup(); return reply.code(413).send({ error: `file too large (max ${maxMB}MB)` }); }
        if (part.file.truncated) { cleanup(); return reply.code(413).send({ error: `file too large (max ${maxMB}MB)` }); }
        const base = (part.filename ? safeBase(part.filename) : '') || `file-${newId()}`; // never trust the client name
        const name = writeUnique(dir, base, buf);
        written.push(path.join(dir, name));
        out.push({ name, size: buf.length, isImage: IMAGE_MIME.has(part.mimetype) });
      }
    } catch (e: any) { cleanup(); return reply.code(413).send({ error: String(e?.message || e) }); }
    if (!out.length) return reply.code(400).send({ error: 'no files uploaded' });
    return { files: out };
  });

  // stream a pending attachment for the composer/message thumbnail. name MUST be a bare basename.
  app.get('/api/sessions/:id/attachments/:name', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id, name } = req.params as any;
    const s = getChat(id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canViewAttachment(u, s)) return reply.code(403).send({ error: 'forbidden' });
    if (!isBareBasename(name)) return reply.code(400).send({ error: 'bad name' });
    const file = path.join(attachDir(s), name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return reply.code(404).send({ error: 'not found' });
    reply.header('Content-Type', contentTypeFor(name));
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(fs.createReadStream(file));
  });

  // drop a pending attachment (composer remove). name MUST be a bare basename.
  app.delete('/api/sessions/:id/attachments/:name', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id, name } = req.params as any;
    const s = getChat(id);
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canWriteSession(u, s)) return reply.code(403).send({ error: 'forbidden' });
    if (!isBareBasename(name)) return reply.code(400).send({ error: 'bad name' });
    try { fs.rmSync(path.join(attachDir(s), name), { force: true }); } catch { /* noop */ }
    return { ok: true };
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canEditChat(u, s)) return reply.code(403).send({ error: 'forbidden' });
    const b = (req.body || {}) as any;
    const patch: any = { updatedAt: Date.now() };
    for (const k of ['title', 'model', 'permissionMode', 'projectId']) if (k in b) patch[k] = b[k];
    if ('effort' in b) {
      if (!EFFORT_LEVELS.includes(b.effort)) return reply.code(400).send({ error: 'invalid effort' });
      patch.effort = b.effort;
    }
    // main-thread team agent: null/'' clears; otherwise the name must resolve for this session's
    // kind/owner right now (the spawn-time guard still covers an agent deleted later)
    if ('agent' in b) {
      const name = String(b.agent || '').trim();
      if (name) {
        const kind = s.kind === 'room' ? 'room' as const : 'user' as const;
        const owner = kind === 'room' ? s.roomId! : s.ownerId;
        if (!resolveAgents(kind, owner, s.projectId)[name]) return reply.code(400).send({ error: `unknown agent '${name}'` });
      }
      patch.agent = name || null;
    }
    // Pool binding and the build container both have a COST: one picks whose Claude plan the turns
    // spend, the other spawns a container. canEditChat lets any authed user edit a room's shared row
    // (it leans on chatSessionId obscurity), which is fine for the model dropdown but too loose here —
    // require the same authority as sending a turn (admin, or a member of the room).
    if (('poolId' in b || 'sandbox' in b) && !canWriteSession(u, s)) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    // Shared-plan pool backing this session's turns. Three states: null = inherit (the sender's own
    // pool, else the workspace-wide one), POOL_OWN = opt out so every sender pays for their own, or
    // a pool id. An unknown id is rejected rather than stored as a binding that resolves to nothing.
    if ('poolId' in b) {
      const pid = String(b.poolId || '');
      if (pid && pid !== POOL_OWN && !getPool(pid)) return reply.code(400).send({ error: 'unknown pool' });
      patch.poolId = pid || null;
    }
    // per-session build container (only meaningful while the admin flag is on; the turn re-checks)
    if ('sandbox' in b) patch.sandbox = b.sandbox ? 1 : 0;
    // Changing the project changes the turn's cwd. The CLI stores each conversation's
    // transcript under the cwd it was created in, so the old resume id can't be found
    // in the new cwd. Reset the SDK conversation when the project actually changes.
    if ('projectId' in b && (b.projectId || null) !== (s.projectId || null)) patch.claudeSessionId = null;
    db.update(schema.chatSessions).set(patch).where(eq(schema.chatSessions.id, id)).run();
    return { ok: true };
  });

  // Manual "name this chat from the conversation" — the button next to Rename. Same access rule as
  // an ordinary rename (canEditChat), and it always overwrites: pressing it is the request.
  app.post('/api/sessions/:id/retitle', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canEditChat(u, s)) return reply.code(403).send({ error: 'forbidden' });
    try {
      const title = await retitleSession({
        sessionId: id, requesterId: u.id,
        emit: (event, payload) => emitToUser(u.id, event, payload),
      });
      return { ok: true, title };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (s.kind !== 'private' || (s.ownerId !== u.id && u.role !== 'admin')) return reply.code(403).send({ error: 'forbidden' });
    db.delete(schema.messages).where(eq(schema.messages.sessionId, id)).run();
    db.delete(schema.chatSessions).where(eq(schema.chatSessions.id, id)).run();
    return { ok: true };
  });

  // delete a single message (display cleanup; does not rewind Claude's own transcript)
  app.delete('/api/sessions/:id/messages/:mid', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id, mid } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canEditChat(u, s)) return reply.code(403).send({ error: 'forbidden' });
    db.delete(schema.messages).where(and(eq(schema.messages.id, mid), eq(schema.messages.sessionId, id))).run();
    return { ok: true };
  });

  // edit = truncate this message and everything after it, then reset the SDK conversation
  // so the caller can re-send the edited text as a fresh turn (regenerate from this point).
  app.post('/api/sessions/:id/messages/:mid/edit', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id, mid } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!canEditChat(u, s)) return reply.code(403).send({ error: 'forbidden' });
    const target = db.select().from(schema.messages)
      .where(and(eq(schema.messages.id, mid), eq(schema.messages.sessionId, id))).get();
    if (!target) return reply.code(404).send({ error: 'message not found' });
    const all = db.select().from(schema.messages).where(eq(schema.messages.sessionId, id))
      .orderBy(schema.messages.createdAt).all();
    for (const m of all) if (m.createdAt >= target.createdAt) db.delete(schema.messages).where(eq(schema.messages.id, m.id)).run();
    db.update(schema.chatSessions).set({ claudeSessionId: null, updatedAt: Date.now() }).where(eq(schema.chatSessions.id, id)).run();
    return { ok: true, messages: loadMessages(id) };
  });
}
