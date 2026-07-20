import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth } from '../auth/index.js';
import { newId } from '../lib/ids.js';

function loadMessages(sessionId: string) {
  return db.select().from(schema.messages).where(eq(schema.messages.sessionId, sessionId))
    .orderBy(schema.messages.createdAt).all()
    .map((m) => ({ ...m, content: JSON.parse(m.content) }));
}

export async function sessionRoutes(app: FastifyInstance) {
  // list private sessions for the current user
  app.get('/api/sessions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const rows = db.select().from(schema.chatSessions)
      .where(and(eq(schema.chatSessions.kind, 'private'), eq(schema.chatSessions.ownerId, u.id)))
      .orderBy(desc(schema.chatSessions.updatedAt)).all();
    return { sessions: rows };
  });

  app.post('/api/sessions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { title, projectId } = (req.body || {}) as any;
    const now = Date.now();
    const row = {
      id: newId(), ownerId: u.id, kind: 'private', roomId: null,
      title: title ? String(title) : '새 대화', projectId: projectId ? String(projectId) : null,
      claudeSessionId: null, model: 'claude-opus-4-8', permissionMode: 'default',
      createdAt: now, updatedAt: now,
    };
    db.insert(schema.chatSessions).values(row).run();
    return { session: row };
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (s.kind === 'private' && s.ownerId !== u.id && u.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    return { session: s, messages: loadMessages(id) };
  });

  app.get('/api/sessions/:id/messages', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (s.kind === 'private' && s.ownerId !== u.id && u.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    return { messages: loadMessages(id) };
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, id)).get();
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (s.kind === 'private' && s.ownerId !== u.id && u.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    const b = (req.body || {}) as any;
    const patch: any = { updatedAt: Date.now() };
    for (const k of ['title', 'model', 'permissionMode', 'projectId']) if (k in b) patch[k] = b[k];
    db.update(schema.chatSessions).set(patch).where(eq(schema.chatSessions.id, id)).run();
    return { ok: true };
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
}
