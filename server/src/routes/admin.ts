import type { FastifyInstance } from 'fastify';
import { requireAdmin, getUserById } from '../auth/index.js';
import { db, schema } from '../db/index.js';
import { usageTotals, usageByUser } from '../usage/tracker.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { config } from '../config.js';
import { turnLimiter } from '../claude/throttle.js';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return {
      users: db.select().from(schema.users).all().length,
      rooms: db.select().from(schema.rooms).all().length,
      sessions: db.select().from(schema.chatSessions).all().length,
      throttle: { max: turnLimiter.max, inUse: turnLimiter.inUse, waiting: turnLimiter.waiting },
      mockClaude: config.mockClaude,
    };
  });

  app.get('/api/admin/usage', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const byUser = usageByUser().map((r) => ({ ...r, name: getUserById(r.userId)?.displayName || r.userId }));
    return { totals: usageTotals(), byUser };
  });

  app.get('/api/admin/settings', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return {
      allowBypass: getSetting('allow_bypass', '1') === '1',
      maxConcurrentTurns: config.maxConcurrentTurns,
      mockClaude: config.mockClaude,
      codeServer: config.codeServer.image,
    };
  });

  app.post('/api/admin/settings', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = (req.body || {}) as any;
    if ('allowBypass' in b) setSetting('allow_bypass', b.allowBypass ? '1' : '0');
    return { ok: true };
  });
}
