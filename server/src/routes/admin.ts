import type { FastifyInstance } from 'fastify';
import { requireAdmin, getUserById } from '../auth/index.js';
import { db, schema } from '../db/index.js';
import { usageTotals, usageByUser } from '../usage/tracker.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { cfg, listConfigForApi, setConfigValue, resetConfigValue, imageConfigValues } from '../lib/config-registry.js';
import { inspectImage, pullImage } from '../lib/docker-images.js';
import { scanResources, runCleanup } from '../admin/cleanup.js';
import { turnLimiter } from '../claude/throttle.js';
import { setCommonToken, clearCommonToken, commonTokenMeta } from '../auth/claude-token.js';
import { getProvider, setProvider, clearProvider } from '../auth/provider.js';

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

  // ── docker image management for image-typed settings (code-server / review sandbox) ──
  // Allowlisted to the current values of image-typed settings so an admin can only act on images
  // the app actually uses (never an arbitrary pull via the mounted socket).
  app.post('/api/admin/image/inspect', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const image = String((req.body as any)?.image || '');
    if (!imageConfigValues().includes(image)) return reply.code(400).send({ error: 'unknown image' });
    return inspectImage(image);
  });
  app.post('/api/admin/image/pull', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const image = String((req.body as any)?.image || '');
    if (!imageConfigValues().includes(image)) return reply.code(400).send({ error: 'unknown image' });
    try { await pullImage(image); }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e).slice(0, 300) }); }
    return inspectImage(image);
  });

  // ── resource cleanup (spawned containers / dangling images / orphaned dirs+rows) ──
  // Read-only scan on GET; destructive actions on POST. Both gated by resourceCleanupEnabled — the
  // server is the real gate (UI hiding is cosmetic). Scans never delete; actions only ever touch
  // app-spawned containers, dangling images, and genuine orphans — never live user data.
  app.get('/api/admin/cleanup', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('resourceCleanupEnabled')) return { enabled: false };
    try { return { enabled: true, ...(await scanResources()) }; }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e).slice(0, 300) }); }
  });
  app.post('/api/admin/cleanup', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('resourceCleanupEnabled')) return reply.code(403).send({ error: 'resource cleanup disabled' });
    const action = String((req.body as any)?.action || '');
    try {
      const summary = await runCleanup(action);
      return { enabled: true, summary, ...(await scanResources()) };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // ── restart the server process; docker's restart policy (unless-stopped) brings it back ──
  app.post('/api/admin/restart', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    setTimeout(() => { console.log('[ccw] admin-triggered restart'); process.exit(0); }, 300);
    return { ok: true };
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

  // ── admin-managed common LLM provider override (shared fallback) — never returns secrets ──
  app.get('/api/admin/provider', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    return { provider: getProvider('common', '') };
  });
  app.put('/api/admin/provider', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    const { type, config } = (req.body || {}) as any;
    try { return { provider: setProvider('common', '', type, config) }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
  app.delete('/api/admin/provider', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    clearProvider('common', '');
    return { provider: null };
  });
}
