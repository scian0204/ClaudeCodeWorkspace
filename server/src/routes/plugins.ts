import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireAdmin, type AuthUser } from '../auth/index.js';
import { newId } from '../lib/ids.js';
import { walkFiles, resolveUnder, IMG_CT } from '../lib/filetree.js';
import * as pm from '../plugins/manager.js';

function ownsPlugin(id: string, userId: string): boolean {
  const p = db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
  return !!p && p.scope === 'user' && p.ownerId === userId;
}
function pluginScope(id: string) {
  return db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
}
// who may VIEW a plugin's detail/files: common → any signed-in user; user-scoped → owner or admin
function canViewPlugin(u: AuthUser, p: NonNullable<ReturnType<typeof pluginScope>>): boolean {
  if (u.role === 'admin') return true;
  if (p.scope === 'common') return true;
  return p.scope === 'user' && p.ownerId === u.id;
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

  // plugin detail: manifest + exposed skills (skills/<dir>/SKILL.md)
  app.get('/api/plugins/:id/detail', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = pluginScope((req.params as any).id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canViewPlugin(u, p)) return reply.code(403).send({ error: 'forbidden' });
    return { plugin: { id: p.id, name: p.name, scope: p.scope, source: p.source, repo: p.repo }, ...pm.pluginDetail(path.resolve(p.path)) };
  });

  // file tree of a plugin dir (paths + sizes) — reuses the shared explorer
  app.get('/api/plugins/:id/tree', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = pluginScope((req.params as any).id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canViewPlugin(u, p)) return reply.code(403).send({ error: 'forbidden' });
    return { files: walkFiles(path.resolve(p.path)) };
  });

  // one file's text content — ?path=<relative>
  app.get('/api/plugins/:id/file', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = pluginScope((req.params as any).id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canViewPlugin(u, p)) return reply.code(403).send({ error: 'forbidden' });
    const full = resolveUnder(path.resolve(p.path), String((req.query as any).path || ''));
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return reply.code(404).send({ error: 'not found' });
    const st = fs.statSync(full);
    if (st.size > 500_000) return { name: full, size: st.size, content: `(파일이 큽니다: ${st.size} bytes — 생략)` };
    const buf = fs.readFileSync(full);
    const content = buf.includes(0) ? '(바이너리 파일 — 미리보기 없음)' : buf.toString('utf8');
    return { name: full, size: st.size, content };
  });

  // raw file bytes — for <img> preview; ?path=<relative>
  app.get('/api/plugins/:id/blob', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = pluginScope((req.params as any).id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canViewPlugin(u, p)) return reply.code(403).send({ error: 'forbidden' });
    const full = resolveUnder(path.resolve(p.path), String((req.query as any).path || ''));
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return reply.code(404).send({ error: 'not found' });
    const ext = (full.split('.').pop() || '').toLowerCase();
    reply.header('Content-Type', IMG_CT[ext] || 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=60');
    return reply.send(fs.createReadStream(full));
  });

  // update a git-installed plugin to the remote's latest (common→admin, personal→owner)
  app.post('/api/plugins/:id/update', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = pluginScope((req.params as any).id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (p.scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if (p.scope === 'user' && !ownsPlugin(p.id, u.id) && u.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    try { await pm.updatePlugin(p.id); return { ok: true }; }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e) }); }
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
