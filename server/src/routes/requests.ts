import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import { io } from '../realtime/io.js';
import { submitRequest, listRequests, decideRequest, actionList } from '../admin/requests.js';

// Broadcast to every client so request lists + the admin pending badge refresh (mirrors review:changed).
function broadcast() { try { io?.emit('requests:changed'); } catch { /* io not ready */ } }

// Member request → admin approval routes. All gated by the `approvalsEnabled` flag (server is the
// real gate; UI hiding is cosmetic). See admin/requests.ts for the action registry.
export async function requestRoutes(app: FastifyInstance) {
  // admin → all requests; member → own
  app.get('/api/requests', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('approvalsEnabled')) return reply.code(404).send({ error: 'approvals disabled' });
    return { requests: listRequests(u) };
  });

  // requestable action types + their form fields (derived from the registry)
  app.get('/api/requests/actions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('approvalsEnabled')) return reply.code(404).send({ error: 'approvals disabled' });
    return { actions: actionList() };
  });

  // submit a pending request
  app.post('/api/requests', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('approvalsEnabled')) return reply.code(404).send({ error: 'approvals disabled' });
    const { type, payload, reason } = (req.body || {}) as any;
    try {
      const request = submitRequest(u, String(type || ''), payload ?? {}, String(reason || ''));
      broadcast();
      return { request };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // approve / reject (admin only) — runs the action on approve, idempotent (executes at most once)
  app.post('/api/requests/:id/decide', async (req, reply) => {
    const u = requireAdmin(req, reply); if (!u) return;
    if (!cfg.bool('approvalsEnabled')) return reply.code(404).send({ error: 'approvals disabled' });
    const { id } = req.params as any;
    const { approve, note } = (req.body || {}) as any;
    try {
      const request = await decideRequest(u, String(id), !!approve, note ? String(note) : undefined);
      broadcast();
      return { request };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
}
