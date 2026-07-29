import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireAuth, requireAdmin } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import * as dm from '../rooms/dm.js';
import { dmJoinUsers, dmNudge } from '../realtime/io.js';

// Server is the real gate: every route requires auth, membership is enforced per-channel, and
// promote is admin-only. The dmEnabled flag hard-404s the whole surface when off (UI also hides it).
function enabled(reply: FastifyReply): boolean {
  if (!cfg.bool('dmEnabled')) { reply.code(404).send({ error: 'dm disabled' }); return false; }
  return true;
}

export async function dmRoutes(app: FastifyInstance) {
  app.get('/api/dm/channels', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    return { channels: dm.listChannels(u.id) };
  });

  app.post('/api/dm/channels', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    const { kind, userId, name, memberIds } = (req.body || {}) as any;
    try {
      let channel;
      if (kind === 'dm') {
        if (!userId) return reply.code(400).send({ error: 'userId required' });
        channel = dm.createDm(u.id, String(userId));
      } else if (kind === 'group') {
        const ids = Array.isArray(memberIds) ? memberIds.map(String) : [];
        channel = dm.createGroup(u.id, String(name || ''), ids);
      } else {
        return reply.code(400).send({ error: 'bad kind' });
      }
      const uids = channel.members.map((m) => m.userId);
      dmJoinUsers(channel.id, uids); // pull members' live sockets into the new channel room
      dmNudge(uids);                 // refresh their sidebar channel lists
      return { channel };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.get('/api/dm/channels/:id/messages', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    const { id } = req.params as any;
    const beforeRaw = (req.query as any)?.before;
    const before = beforeRaw ? Number(beforeRaw) : undefined;
    const messages = dm.listMessages(String(id), u.id, Number.isFinite(before as number) ? before : undefined);
    if (messages === null) return reply.code(403).send({ error: 'forbidden' }); // not a member
    return { messages };
  });

  app.post('/api/dm/channels/:id/read', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    const { id } = req.params as any;
    if (!dm.isMember(String(id), u.id)) return reply.code(403).send({ error: 'forbidden' });
    dm.markRead(String(id), u.id);
    dmNudge([u.id]);
    return { ok: true };
  });

  // Promote a group channel to a common project room (admin only), seeded with the channel members.
  app.post('/api/dm/channels/:id/promote', async (req, reply) => {
    const u = requireAdmin(req, reply); if (!u) return;
    if (!enabled(reply)) return;
    const { id } = req.params as any;
    try {
      const roomId = dm.promoteToRoom(String(id), u.id);
      return { roomId };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
}
