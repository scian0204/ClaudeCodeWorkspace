import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireAdmin } from '../auth/index.js';
import { newId } from '../lib/ids.js';
import * as pm from '../plugins/manager.js';

function ownsPlugin(id: string, userId: string): boolean {
  const p = db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
  return !!p && p.scope === 'user' && p.ownerId === userId;
}
function pluginScope(id: string) {
  return db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
}

export async function pluginRoutes(app: FastifyInstance) {
  app.get('/api/plugins', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return {
      common: pm.listPlugins('common'),
      mine: pm.listPlugins('user', u.id),
      prefs: pm.getUserPrefs(u.id),
    };
  });

  app.get('/api/marketplaces', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return { common: pm.listMarketplaces('common'), mine: pm.listMarketplaces('user', u.id) };
  });

  app.post('/api/marketplaces', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { scope, name, url } = (req.body || {}) as any;
    if (scope === 'common' && !requireAdmin(req, reply)) return;
    const row = pm.addMarketplace(scope === 'common' ? 'common' : 'user', scope === 'common' ? null : u.id, String(name), String(url));
    return { marketplace: row };
  });

  app.delete('/api/marketplaces/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    pm.removeMarketplace((req.params as any).id);
    return { ok: true };
  });

  // install from git (marketplace repo url)
  app.post('/api/plugins/install', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { scope, name, repo } = (req.body || {}) as any;
    if (scope === 'common' && !requireAdmin(req, reply)) return;
    if (!name || !repo) return reply.code(400).send({ error: 'name/repo required' });
    try {
      const row = await pm.installFromGit(scope === 'common' ? 'common' : 'user', scope === 'common' ? null : u.id, String(name), String(repo));
      return { plugin: row };
    } catch (e: any) { return reply.code(500).send({ error: String(e?.message || e) }); }
  });

  // local upload: multipart .tar.gz, fields: scope, name
  app.post('/api/plugins/upload', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const parts = (req as any).parts();
    let scope = 'user', name = '', tmp = '';
    for await (const part of parts) {
      if (part.type === 'file') {
        tmp = path.join(os.tmpdir(), `ccw-plugin-${newId()}.tar.gz`);
        await pipeline(part.file, fs.createWriteStream(tmp));
      } else {
        if (part.fieldname === 'scope') scope = String(part.value);
        if (part.fieldname === 'name') name = String(part.value);
      }
    }
    if (scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if (!name || !tmp) return reply.code(400).send({ error: 'name + file required' });
    try {
      const row = await pm.installFromTarball(scope === 'common' ? 'common' : 'user', scope === 'common' ? null : u.id, name, tmp);
      return { plugin: row };
    } catch (e: any) { return reply.code(500).send({ error: String(e?.message || e) }); }
    finally { fs.rm(tmp, () => {}); }
  });

  app.post('/api/plugins/:id/enabled', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any; const { enabled } = (req.body || {}) as any;
    const p = pluginScope(id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (p.scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if (p.scope === 'user' && !ownsPlugin(id, u.id)) return reply.code(403).send({ error: 'forbidden' });
    pm.setEnabled(id, !!enabled);
    return { ok: true };
  });

  app.post('/api/plugins/:id/forced', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any; const { forced } = (req.body || {}) as any;
    pm.setForced(id, !!forced);
    return { ok: true };
  });

  // per-user on/off of a common (class-2) plugin
  app.post('/api/plugins/:id/pref', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any; const { enabled } = (req.body || {}) as any;
    const p = pluginScope(id);
    if (!p || p.scope !== 'common') return reply.code(400).send({ error: 'common plugins only' });
    if (p.forced) return reply.code(403).send({ error: 'plugin is mandatory (admin-forced)' });
    pm.setUserPref(u.id, id, !!enabled);
    return { ok: true };
  });

  app.delete('/api/plugins/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const p = pluginScope(id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (p.scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if (p.scope === 'user' && !ownsPlugin(id, u.id)) return reply.code(403).send({ error: 'forbidden' });
    pm.removePlugin(id);
    return { ok: true };
  });
}
