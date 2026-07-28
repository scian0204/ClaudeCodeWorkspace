import type { FastifyInstance } from 'fastify';
import { requireAdmin, getUserById } from '../auth/index.js';
import { db, schema } from '../db/index.js';
import { usageTotals, usageByUser } from '../usage/tracker.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { cfg, listConfigForApi, setConfigValue, resetConfigValue } from '../lib/config-registry.js';
import { turnLimiter } from '../claude/throttle.js';
import { setCommonToken, clearCommonToken, commonTokenMeta } from '../auth/claude-token.js';

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return {
      users: db.select().from(schema.users).all().length,
      rooms: db.select().from(schema.rooms).all().length,
      sessions: db.select().from(schema.chatSessions).all().length,
      throttle: { max: turnLimiter.max, inUse: turnLimiter.inUse, waiting: turnLimiter.waiting },
      forceMock: cfg.bool('forceMock'),
      commonToken: commonTokenMeta(), // shared fallback status (admin-set DB token or env)
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
      commonToken: commonTokenMeta(),
    };
  });

  app.post('/api/admin/settings', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = (req.body || {}) as any;
    if ('allowBypass' in b) setSetting('allow_bypass', b.allowBypass ? '1' : '0');
    return { ok: true };
  });

  // ── full config registry: every admin-manageable setting (env + hardcoded constants) ──
  app.get('/api/admin/config', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { items: listConfigForApi() };
  });
  app.put('/api/admin/config', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { key, value } = (req.body || {}) as any;
    if (!key) return reply.code(400).send({ error: 'key required' });
    try { setConfigValue(String(key), value); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return { items: listConfigForApi() };
  });
  app.delete('/api/admin/config/:key', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { key } = req.params as any;
    try { resetConfigValue(String(key)); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return { items: listConfigForApi() };
  });

  // ── admin-managed common (shared) Claude token ──
  app.get('/api/admin/claude-token', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { commonToken: commonTokenMeta() };
  });
  app.put('/api/admin/claude-token', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { token } = (req.body || {}) as any;
    if (!token) return reply.code(400).send({ error: 'token required' });
    try { setCommonToken(String(token)); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return { commonToken: commonTokenMeta() };
  });
  app.delete('/api/admin/claude-token', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    clearCommonToken();
    return { commonToken: commonTokenMeta() };
  });
}
