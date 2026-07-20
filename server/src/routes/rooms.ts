import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, getUserById } from '../auth/index.js';
import * as rooms from '../rooms/manager.js';

function messagesFor(chatSessionId: string) {
  return db.select().from(schema.messages).where(eq(schema.messages.sessionId, chatSessionId))
    .orderBy(schema.messages.createdAt).all().map((m) => ({ ...m, content: JSON.parse(m.content) }));
}

export async function roomRoutes(app: FastifyInstance) {
  app.get('/api/rooms', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return { rooms: rooms.listRoomsForUser(u) };
  });

  app.post('/api/rooms', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { name } = (req.body || {}) as any;
    if (!name) return reply.code(400).send({ error: 'name required' });
    const room = rooms.createRoom(u, String(name));
    return { room: { ...room, members: rooms.getMembers(room.id) } };
  });

  app.get('/api/rooms/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const room = rooms.getRoom(id);
    if (!room) return reply.code(404).send({ error: 'not found' });
    if (u.role !== 'admin' && !rooms.isMember(id, u.id)) return reply.code(403).send({ error: 'forbidden' });
    return {
      room: { ...room, members: rooms.getMembers(id) },
      messages: messagesFor(room.chatSessionId),
    };
  });

  app.post('/api/rooms/:id/members', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    if (!rooms.can(id, u, 'invite')) return reply.code(403).send({ error: 'forbidden' });
    const { userId } = (req.body || {}) as any;
    if (!userId || !getUserById(String(userId))) return reply.code(400).send({ error: 'unknown user' });
    rooms.addMember(id, String(userId));
    return { members: rooms.getMembers(id) };
  });

  app.delete('/api/rooms/:id/members/:userId', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id, userId } = req.params as any;
    const selfLeave = userId === u.id;
    if (!selfLeave && !rooms.can(id, u, 'kick')) return reply.code(403).send({ error: 'forbidden' });
    rooms.removeMember(id, userId);
    return { ok: true };
  });

  // set delegation toggle — owner/admin only (giving power is the owner's job)
  app.post('/api/rooms/:id/members/:userId/delegation', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id, userId } = req.params as any;
    if (!rooms.canSetMode(id, u)) return reply.code(403).send({ error: 'owner only' });
    const { perm, on } = (req.body || {}) as any;
    if (!rooms.DELEGABLE.includes(perm)) return reply.code(400).send({ error: 'bad perm' });
    rooms.setDelegation(id, userId, perm, !!on);
    return { members: rooms.getMembers(id) };
  });

  app.post('/api/rooms/:id/transfer', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    if (!rooms.can(id, u, 'transfer')) return reply.code(403).send({ error: 'forbidden' });
    const { userId } = (req.body || {}) as any;
    rooms.transferOwner(id, String(userId));
    return { room: { ...rooms.getRoom(id), members: rooms.getMembers(id) } };
  });

  app.post('/api/rooms/:id/mode', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    if (!rooms.canSetMode(id, u)) return reply.code(403).send({ error: 'owner only' });
    const { mode } = (req.body || {}) as any;
    rooms.setPermissionMode(id, String(mode));
    return { ok: true };
  });

  app.patch('/api/rooms/:id/project', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    if (u.role !== 'admin' && !rooms.isMember(id, u.id)) return reply.code(403).send({ error: 'forbidden' });
    const room = rooms.getRoom(id); if (!room) return reply.code(404).send({ error: 'not found' });
    const { projectId } = (req.body || {}) as any;
    db.update(schema.chatSessions).set({ projectId: projectId || null }).where(eq(schema.chatSessions.id, room.chatSessionId)).run();
    return { ok: true };
  });

  app.delete('/api/rooms/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    if (!rooms.can(id, u, 'delete_room')) return reply.code(403).send({ error: 'forbidden' });
    rooms.deleteRoom(id);
    return { ok: true };
  });
}
