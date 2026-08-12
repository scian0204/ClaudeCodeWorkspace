import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import { listAgents, getAgent, createAgent, updateAgent, setAgentEnabled, deleteAgent } from '../claude/team-agents.js';

// Team-agent CRUD. Mirrors the plugins trust model: 'common' agents are admin-only (their prompt is
// injected into every member's turns once enabled — same class as forced plugins), personal agents
// belong to their owner. Server-side feature gate per rule 10 — UI hiding alone is not a gate.
export async function agentRoutes(app: FastifyInstance) {
  const off = (reply: any) =>
    cfg.bool('teamAgentsEnabled') ? false : (reply.code(403).send({ error: 'team agents are disabled' }), true);
  // admin may manage everything; a member only their own personal rows
  const canManage = (u: { id: string; role: string }, row: { scope: string; ownerId: string }) =>
    u.role === 'admin' || (row.scope === 'user' && row.ownerId === u.id);

  app.get('/api/agents', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (off(reply)) return;
    return listAgents(u.id);
  });

  app.post('/api/agents', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (off(reply)) return;
    const b = (req.body || {}) as any;
    const scope = b.scope === 'common' ? 'common' : 'user';
    if (scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
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
