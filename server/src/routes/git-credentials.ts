import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../auth/index.js';
import {
  listUserGitCreds, listCommonGitCreds, addGitCred, deleteGitCred, getGitCredRow,
} from '../auth/git-cred.js';

export async function gitCredentialRoutes(app: FastifyInstance) {
  // list — the caller's own creds + the shared common creds (meta only, never the token)
  app.get('/api/git-credentials', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return { mine: listUserGitCreds(u.id), common: listCommonGitCreds() };
  });

  // create / update — user scope for anyone; common scope is admin-only
  app.post('/api/git-credentials', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const b = (req.body || {}) as any;
    const scope = b.scope === 'common' ? 'common' : 'user';
    if (scope === 'common' && !requireAdmin(req, reply)) return;
    try {
      const credential = addGitCred({
        scope, ownerId: u.id, provider: b.provider, host: b.host, username: b.username,
        token: b.token, authorName: b.authorName, authorEmail: b.authorEmail,
      });
      return { credential };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/git-credentials/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const row = getGitCredRow(id);
    if (!row) return reply.code(404).send({ error: 'not found' });
    const ownUser = row.scope === 'user' && row.ownerId === u.id;
    const adminCommon = row.scope === 'common' && u.role === 'admin';
    if (!ownUser && !adminCommon) return reply.code(403).send({ error: 'forbidden' });
    deleteGitCred(id);
    return { ok: true };
  });
}
