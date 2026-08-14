import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import {
  listPools, createPool, deletePool, setStrategy, join, leave,
  getPool, hasCredential, userDefaultPool, setUserDefaultPool,
  POOL_ALL, allUsersPoolOn, poolOptOut, setPoolOptOut,
} from '../auth/token-pool.js';

// Shared-plan pools ("토큰 모아쓰기"). Every route is gated on the admin flag server-side — hiding
// the UI is not a control. The consent rule lives here: join/leave only ever act on the CALLER's own
// membership, so no one can put another member's Claude plan into a pool.
export async function poolRoutes(app: FastifyInstance) {
  const off = (reply: any) => reply.code(403).send({ error: 'token pooling is disabled' });

  app.get('/api/pools', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('tokenPoolEnabled')) return { pools: [], allUsers: false, myPoolId: null, optedOut: false, hasCredential: false, canCreate: false };
    return {
      pools: listPools(),               // the derived workspace-wide pool leads the list when it is on
      allUsers: allUsersPoolOn(),       // admin mode: everyone with a plan shares, no joining needed
      myPoolId: userDefaultPool(u.id),  // this user's own party, one level more specific
      optedOut: poolOptOut(u.id),       // this user keeps their plan out of the workspace-wide pool
      hasCredential: hasCredential(u.id), // no plan registered → joining would contribute nothing
      canCreate: u.role === 'admin' || cfg.bool('tokenPoolPartyCreate'),
    };
  });

  // Anyone may start a party pool while tokenPoolPartyCreate is on; admins always may.
  app.post('/api/pools', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('tokenPoolEnabled')) return off(reply);
    if (u.role !== 'admin' && !cfg.bool('tokenPoolPartyCreate')) return reply.code(403).send({ error: 'forbidden' });
    const b = (req.body || {}) as any;
    try {
      // creating a pool does NOT enrol the creator's plan — they join like everyone else
      return { id: createPool(String(b.name || ''), u.id, String(b.strategy || '')) };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/pools/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('tokenPoolEnabled')) return off(reply);
    const { id } = req.params as any;
    if (id === POOL_ALL) return reply.code(400).send({ error: 'the workspace-wide pool is managed in admin settings' });
    const pool = getPool(id);
    if (!pool) return reply.code(404).send({ error: 'not found' });
    if (u.role !== 'admin' && pool.ownerId !== u.id) return reply.code(403).send({ error: 'forbidden' });
    deletePool(id);
    return { ok: true };
  });

  app.put('/api/pools/:id/strategy', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('tokenPoolEnabled')) return off(reply);
    const { id } = req.params as any;
    if (id === POOL_ALL) return reply.code(400).send({ error: 'the workspace-wide pool is managed in admin settings' });
    const pool = getPool(id);
    if (!pool) return reply.code(404).send({ error: 'not found' });
    if (u.role !== 'admin' && pool.ownerId !== u.id) return reply.code(403).send({ error: 'forbidden' });
    // '' means "follow the admin default". Anything else unrecognised is rejected rather than
    // normalised to '' — a typo would silently discard the pool's real setting and still answer 200.
    const strategy = String((req.body as any)?.strategy ?? '');
    if (!['', 'rotate', 'sequential'].includes(strategy)) {
      return reply.code(400).send({ error: `unknown strategy '${strategy}' (rotate | sequential)` });
    }
    setStrategy(id, strategy);
    return { ok: true };
  });

  // Consent: the user id is taken from the session cookie, never from the body.
  app.post('/api/pools/:id/join', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('tokenPoolEnabled')) return off(reply);
    const { id } = req.params as any;
    if (id === POOL_ALL) return reply.code(400).send({ error: 'the workspace-wide pool has no membership to join' });
    try { join(id, u.id); return { ok: true }; }
    catch (e: any) { return reply.code(404).send({ error: String(e?.message || e) }); }
  });

  // A member may always leave. An admin or the pool's creator may remove someone else — that can
  // only ever spend LESS of another person's plan, so it needs no extra consent.
  app.post('/api/pools/:id/leave', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('tokenPoolEnabled')) return off(reply);
    const { id } = req.params as any;
    if (id === POOL_ALL) return reply.code(400).send({ error: 'use the opt-out switch for the workspace-wide pool' });
    const target = String((req.body as any)?.userId || u.id);
    if (target !== u.id) {
      const pool = getPool(id);
      if (!pool) return reply.code(404).send({ error: 'not found' });
      if (u.role !== 'admin' && pool.ownerId !== u.id) return reply.code(403).send({ error: 'forbidden' });
    }
    leave(id, target);
    return { ok: true };
  });

  // The caller's OWN default pool — the middle level, under a session's explicit choice and over the
  // admin's workspace-wide one. Self-only by construction (id from the cookie) and it can only name a
  // pool the caller already joined, so it never enrols anyone.
  app.put('/api/pools/my-default', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('tokenPoolEnabled')) return off(reply);
    try { setUserDefaultPool(u.id, ((req.body as any)?.poolId as string) || null); return { ok: true }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // Keep MY plan out of the workspace-wide pool. The admin switch decides whether the workspace
  // shares at all; this is the individual's answer to it, and only ever about their own plan.
  app.put('/api/pools/opt-out', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('tokenPoolEnabled')) return off(reply);
    setPoolOptOut(u.id, !!(req.body as any)?.optOut);
    return { ok: true };
  });
}
