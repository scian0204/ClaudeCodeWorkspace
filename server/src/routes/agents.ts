import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import { db, schema } from '../db/index.js';
import { listAgents, getAgent, createAgent, updateAgent, setAgentEnabled, deleteAgent } from '../claude/team-agents.js';
import { listFsAgents } from '../claude/fs-agents.js';
import { canAccessProject, getProject } from './projects.js';

// Team-agent CRUD. Mirrors the plugins trust model: 'common' agents are admin-only (their prompt is
// injected into every member's turns once enabled — same class as forced plugins), personal agents
// belong to their owner. Project agents inject into every session of that project (any member on a
// common project), so managing them is admin-only except on the caller's own personal projects.
// Server-side feature gate per rule 10 — UI hiding alone is not a gate.
export async function agentRoutes(app: FastifyInstance) {
  const off = (reply: any) =>
    cfg.bool('teamAgentsEnabled') ? false : (reply.code(403).send({ error: 'team agents are disabled' }), true);
  const canManageProject = (u: { id: string; role: string }, projectId: string) => {
    if (u.role === 'admin') return true;
    const p = getProject(projectId);
    return !!p && p.scope === 'user' && p.ownerId === u.id;
  };
  const canManage = (u: { id: string; role: string }, row: { scope: string; ownerId: string; projectId: string }) =>
    u.role === 'admin' || (row.scope === 'user' && row.ownerId === u.id)
    || (row.scope === 'project' && canManageProject(u, row.projectId));

  app.get('/api/agents', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (off(reply)) return;
    const visible = db.select().from(schema.projects).all().filter((p) => canAccessProject(u, p));
    // `files` = read-only .claude/agents/*.md found on disk (the CLI loads them by itself via
    // settingSources — listing them here is what makes agents Claude wrote as files visible in the UI)
    return { ...listAgents(u.id, visible.map((p) => p.id)), files: listFsAgents(u.id, visible) };
  });

  app.post('/api/agents', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (off(reply)) return;
    const b = (req.body || {}) as any;
    const scope = b.scope === 'common' ? 'common' : b.scope === 'project' ? 'project' : 'user';
    if (scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if (scope === 'project') {
      const pid = String(b.projectId || '').trim();
      if (!pid || !getProject(pid)) return reply.code(400).send({ error: 'unknown project' });
      if (!canManageProject(u, pid)) return reply.code(403).send({ error: 'forbidden' });
      try { return { agent: createAgent(scope, u.id, b, pid) }; }
      catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    }
    try { return { agent: createAgent(scope, u.id, b) }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.patch('/api/agents/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (off(reply)) return;
    const row = getAgent((req.params as any).id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (!canManage(u, row)) return reply.code(403).send({ error: 'forbidden' });
    try { return { agent: updateAgent(row.id, req.body || {}) }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.post('/api/agents/:id/enabled', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (off(reply)) return;
    const row = getAgent((req.params as any).id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (!canManage(u, row)) return reply.code(403).send({ error: 'forbidden' });
    setAgentEnabled(row.id, !!(req.body as any)?.enabled);
    return { ok: true };
  });

  app.delete('/api/agents/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (off(reply)) return;
    const row = getAgent((req.params as any).id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (!canManage(u, row)) return reply.code(403).send({ error: 'forbidden' });
    deleteAgent(row.id);
    return { ok: true };
  });
}
