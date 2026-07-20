import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireAdmin, type AuthUser } from '../auth/index.js';
import { paths, ensure } from '../lib/paths.js';
import { newId } from '../lib/ids.js';
import * as rooms from '../rooms/manager.js';
import * as cs from '../codeserver/manager.js';

function safeName(n: string) { return String(n).replace(/[^a-zA-Z0-9._ -]/g, '').trim() || 'project'; }

function canAccess(u: AuthUser, p: NonNullable<ReturnType<typeof getProject>>): boolean {
  if (u.role === 'admin') return true;
  if (p.scope === 'common') return true;
  if (p.scope === 'user') return p.ownerId === u.id;
  if (p.scope === 'room') return rooms.isMember(p.ownerId!, u.id);
  return false;
}
function getProject(id: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const common = db.select().from(schema.projects).where(eq(schema.projects.scope, 'common')).all();
    const mine = db.select().from(schema.projects)
      .where(and(eq(schema.projects.scope, 'user'), eq(schema.projects.ownerId, u.id))).all();
    return { common, mine };
  });

  app.get('/api/projects/room/:roomId', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { roomId } = req.params as any;
    if (u.role !== 'admin' && !rooms.isMember(roomId, u.id)) return reply.code(403).send({ error: 'forbidden' });
    const list = db.select().from(schema.projects)
      .where(and(eq(schema.projects.scope, 'room'), eq(schema.projects.ownerId, roomId))).all();
    return { projects: list };
  });

  app.post('/api/projects', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { scope, name, roomId } = (req.body || {}) as any;
    const nm = safeName(name);
    let dir: string, ownerId: string | null;
    if (scope === 'common') {
      if (!requireAdmin(req, reply)) return;
      dir = path.join(paths.commonProjects, nm); ownerId = null;
    } else if (scope === 'room') {
      if (u.role !== 'admin' && !rooms.isMember(roomId, u.id)) return reply.code(403).send({ error: 'forbidden' });
      dir = path.join(paths.roomProjects(roomId), nm); ownerId = roomId;
    } else {
      dir = path.join(paths.userProjects(u.id), nm); ownerId = u.id;
    }
    ensure(dir);
    const row = { id: newId(), scope: scope || 'user', ownerId, name: nm, path: dir, createdAt: Date.now() };
    db.insert(schema.projects).values(row).run();
    return { project: row };
  });

  app.post('/api/projects/:id/open-editor', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const p = getProject(id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canAccess(u, p)) return reply.code(403).send({ error: 'forbidden' });
    if (!cs.dockerAvailable()) return reply.code(501).send({ error: 'code-server unavailable — run via Docker deployment' });
    try {
      const { url } = await cs.open(u.id, p.id, p.path);
      return { url };
    } catch (e: any) {
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const p = getProject(id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (p.scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if (p.scope === 'user' && p.ownerId !== u.id && u.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    // only removes the DB index entry; files remain on the volume (safe)
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
    return { ok: true };
  });
}
