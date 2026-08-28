import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireAdmin, type AuthUser } from '../auth/index.js';
import { canAccessProject, canManageProject, getProject } from './projects.js';
import { newId } from '../lib/ids.js';
import { listDir, resolveUnder, IMG_CT } from '../lib/filetree.js';
import * as pm from '../plugins/manager.js';
import { skillUsageRows } from '../usage/tracker.js';
import { cfg } from '../lib/config-registry.js';

function pluginScope(id: string) {
  return db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
}
type PluginRow = NonNullable<ReturnType<typeof pluginScope>>;
// The projects whose plugins the caller may SEE (their own + every common one, admins everything).
function visibleProjectIds(u: AuthUser): string[] {
  return db.select().from(schema.projects).all().filter((p) => canAccessProject(u, p)).map((p) => p.id);
}
// who may INSTALL/TOGGLE/DELETE a plugin: common → admin; personal → owner; project → whoever may
// manage that project (admins anywhere, members on their own personal projects)
function canMutatePlugin(u: AuthUser, p: PluginRow): boolean {
  if (u.role === 'admin') return true;
  if (p.scope === 'user') return p.ownerId === u.id;
  if (p.scope === 'project') return canManageProject(u, p.projectId);
  return false;   // common
}
// who may EDIT/DELETE a registered marketplace: common → admin only; user-scoped → owner or admin
function canMutateMarket(u: AuthUser, m: { scope: string; ownerId: string | null }): boolean {
  if (u.role === 'admin') return true;
  return m.scope === 'user' && m.ownerId === u.id;
}
// who may VIEW a plugin's detail/files: common → any signed-in user; personal → owner or admin;
// project → anyone who may open that project (its plugins run in their sessions, so they can read them)
function canViewPlugin(u: AuthUser, p: PluginRow): boolean {
  if (u.role === 'admin') return true;
  if (p.scope === 'common') return true;
  if (p.scope === 'project') {
    const proj = getProject(p.projectId);
    return !!proj && canAccessProject(u, proj);
  }
  return p.scope === 'user' && p.ownerId === u.id;
}

// Attach invocation counters to a plugin's skills: `total` (workspace-wide) + `mine` (the viewer's
// own) for everyone, plus the per-user breakdown for admins — that one is other people's activity.
// Counters are keyed by the raw invocation string, so match on skillKey of both dir and frontmatter
// name (a skill is invoked as "plugin:dir" from the palette and as its name from the Skill tool).
type PluginSkill = ReturnType<typeof pm.pluginDetail>['skills'][number];
function withSkillUsage(skills: PluginSkill[], viewer: AuthUser) {
  const rows = skillUsageRows();
  return skills.map((s) => {
    const keys = new Set([pm.skillKey(s.dir), pm.skillKey(s.name)]);
    const byUser = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      if (!keys.has(pm.skillKey(r.skill))) continue;
      const e = byUser.get(r.userId) || { name: r.name || r.userId, count: 0 };
      e.count += r.count;
      byUser.set(r.userId, e);
    }
    const list = [...byUser].map(([userId, v]) => ({ userId, ...v })).sort((a, b) => b.count - a.count);
    return {
      ...s,
      total: list.reduce((n, r) => n + r.count, 0),
      mine: byUser.get(viewer.id)?.count || 0,
      ...(viewer.role === 'admin' ? { byUser: list } : {}),
    };
  });
}

export async function pluginRoutes(app: FastifyInstance) {
  app.get('/api/plugins', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return {
      common: pm.listPlugins('common'),
      mine: pm.listPlugins('user', u.id),
      projects: pm.listProjectPlugins(visibleProjectIds(u)),
      prefs: pm.getUserPrefs(u.id),
    };
  });

  app.get('/api/marketplaces', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return { common: pm.listMarketplaces('common'), mine: pm.listMarketplaces('user', u.id) };
  });

  // register a marketplace from one field: "foo/bar" or a full git URL (`ref`, `url` both accepted).
  // The repo is cloned here, so the name comes from its own marketplace.json.
  app.post('/api/marketplaces', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { scope, ref, url, name } = (req.body || {}) as any;
    if (scope === 'common' && !requireAdmin(req, reply)) return;
    const src = String(ref || url || name || '').trim();
    if (!src) return reply.code(400).send({ error: 'repo required — "owner/repo" or a git URL' });
    try {
      const row = await pm.addMarketplace(scope === 'common' ? 'common' : 'user', scope === 'common' ? null : u.id, src);
      return { marketplace: row };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // what a marketplace offers (.claude-plugin/marketplace.json in its repo). ?refresh=1 pulls first.
  app.get('/api/marketplaces/:id/plugins', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const m = pm.getMarketplace((req.params as any).id); if (!m) return reply.code(404).send({ error: 'not found' });
    if (!canMutateMarket(u, m)) return reply.code(403).send({ error: 'forbidden' });
    try { return await pm.marketplaceCatalog(m.id, String((req.query as any)?.refresh || '') === '1'); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // pull the marketplace repo's latest — new plugins pushed there show up after this
  app.post('/api/marketplaces/:id/refresh', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const m = pm.getMarketplace((req.params as any).id); if (!m) return reply.code(404).send({ error: 'not found' });
    if (!canMutateMarket(u, m)) return reply.code(403).send({ error: 'forbidden' });
    try { await pm.syncMarketplace(m.id); return await pm.marketplaceCatalog(m.id); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/marketplaces/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const m = pm.getMarketplace((req.params as any).id); if (!m) return reply.code(404).send({ error: 'not found' });
    if (!canMutateMarket(u, m)) return reply.code(403).send({ error: 'forbidden' });
    pm.removeMarketplace(m.id);
    return { ok: true };
  });

  // install a plugin. `name` is a plugin name or "<plugin>@<marketplace>"; `repo` is a git URL or
  // "owner/repo". Either field alone works: a name alone is looked up in the registered marketplaces,
  // a repo alone is cloned and named after itself, and both together clone under the given name.
  app.post('/api/plugins/install', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { scope, name, repo, plugin, marketplaceId, projectId } = (req.body || {}) as any;
    if (scope === 'common' && !requireAdmin(req, reply)) return;
    const common = scope === 'common';
    const target: pm.PluginScope = common ? 'common' : scope === 'project' ? 'project' : 'user';
    const pid = String(projectId || '').trim();
    if (target === 'project') {
      if (!pid || !getProject(pid)) return reply.code(400).send({ error: 'unknown project' });
      if (!canManageProject(u, pid)) return reply.code(403).send({ error: 'forbidden' });
    }
    const owner = target === 'user' ? u.id : null;
    const asked = String(name || plugin || '').trim();
    const gitRef = String(repo || '').trim();
    if (!asked && !gitRef) return reply.code(400).send({ error: 'plugin name or repo required' });

    // a marketplace install: by id (row button), by "<plugin>@<marketplace>", or by a bare plugin
    // name that only one registered marketplace offers
    const market = pm.parseMarketRef(asked) || pm.parseMarketRef(gitRef);
    if (marketplaceId || market || !gitRef) {
      try {
        let mid = marketplaceId as string | undefined;
        let want = asked;
        if (!mid && market) {
          const rows = [...pm.listMarketplaces('user', u.id), ...pm.listMarketplaces('common')];
          const m = rows.find((r) => r.name.toLowerCase() === market.market.toLowerCase());
          if (!m) return reply.code(404).send({ error: `등록된 마켓플레이스가 아닙니다: ${market.market}` });
          mid = m.id; want = market.plugin;
        }
        if (!mid) mid = await pm.findMarketplaceFor(asked, u.id);
        const m = pm.getMarketplace(mid);
        if (!m) return reply.code(404).send({ error: 'not found' });
        if (m.scope === 'common' && u.role !== 'admin' && common) return reply.code(403).send({ error: 'admin only' });
        return { plugin: await pm.installFromMarketplace(target, owner, mid, want || String(plugin || ''), pid) };
      } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    }

    if (!pm.isRepoRef(gitRef)) return reply.code(400).send({ error: 'repo must be "owner/repo" or a git URL' });
    try {
      const row = await pm.installFromGit(target, owner, asked, gitRef, pid);
      return { plugin: row };
    } catch (e: any) { return reply.code(500).send({ error: String(e?.message || e) }); }
  });

  // local upload: multipart .tar.gz, fields: scope, name
  app.post('/api/plugins/upload', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const parts = (req as any).parts();
    let scope = 'user', name = '', tmp = '', projectId = '';
    for await (const part of parts) {
      if (part.type === 'file') {
        tmp = path.join(os.tmpdir(), `ccw-plugin-${newId()}.tar.gz`);
        await pipeline(part.file, fs.createWriteStream(tmp));
      } else {
        if (part.fieldname === 'scope') scope = String(part.value);
        if (part.fieldname === 'name') name = String(part.value);
        if (part.fieldname === 'projectId') projectId = String(part.value).trim();
      }
    }
    const target: pm.PluginScope = scope === 'common' ? 'common' : scope === 'project' ? 'project' : 'user';
    try {
      if (target === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
      if (target === 'project') {
        if (!projectId || !getProject(projectId)) return reply.code(400).send({ error: 'unknown project' });
        if (!canManageProject(u, projectId)) return reply.code(403).send({ error: 'forbidden' });
      }
      if (!name || !tmp) return reply.code(400).send({ error: 'name + file required' });
      const row = await pm.installFromTarball(target, target === 'user' ? u.id : null, name, tmp, projectId);
      return { plugin: row };
    } catch (e: any) { return reply.code(500).send({ error: String(e?.message || e) }); }
    finally { fs.rm(tmp, () => {}); }
  });

  app.post('/api/plugins/:id/enabled', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any; const { enabled } = (req.body || {}) as any;
    const p = pluginScope(id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canMutatePlugin(u, p)) return reply.code(403).send({ error: p.scope === 'common' ? 'admin only' : 'forbidden' });
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
    const d = pm.pluginDetail(path.resolve(p.path));
    return {
      plugin: { id: p.id, name: p.name, scope: p.scope, source: p.source, repo: p.repo },
      ...d,
      skills: cfg.bool('skillUsageEnabled') ? withSkillUsage(d.skills, u) : d.skills,
    };
  });

  // ONE directory level of a plugin dir — same lazy contract as the project tree. ?path=<relative>
  app.get('/api/plugins/:id/tree', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = pluginScope((req.params as any).id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canViewPlugin(u, p)) return reply.code(403).send({ error: 'forbidden' });
    const rel = String((req.query as any)?.path || '').trim();
    if (rel.split('/').includes('..')) return reply.code(400).send({ error: 'bad path' });
    return listDir(path.resolve(p.path), rel, { limit: cfg.int('fileTreeMaxEntries') });
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
    if (!canMutatePlugin(u, p)) return reply.code(403).send({ error: p.scope === 'common' ? 'admin only' : 'forbidden' });
    try { await pm.updatePlugin(p.id); return { ok: true }; }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/plugins/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const p = pluginScope(id); if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canMutatePlugin(u, p)) return reply.code(403).send({ error: p.scope === 'common' ? 'admin only' : 'forbidden' });
    pm.removePlugin(id);
    return { ok: true };
  });
}
