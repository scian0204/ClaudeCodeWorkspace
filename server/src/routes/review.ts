import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../auth/index.js';
import * as review from '../review/manager.js';

export async function reviewRoutes(app: FastifyInstance) {
  // ── watched repos (admin) ──
  app.get('/api/review/repos', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { repos: review.listRepoSummaries() };
  });

  app.post('/api/review/repos', async (req, reply) => {
    const u = requireAdmin(req, reply); if (!u) return;
    const b = (req.body || {}) as any;
    if (!b.gitUrl || !String(b.gitUrl).trim()) return reply.code(400).send({ error: '원격지 URL이 필요합니다' });
    if (!b.credentialId) return reply.code(400).send({ error: '병합권한 자격증명을 선택하세요' });
    try {
      const repo = await review.createRepo(u, {
        name: b.name ? String(b.name) : undefined, gitUrl: String(b.gitUrl),
        credentialId: String(b.credentialId), provider: b.provider ? String(b.provider) : undefined,
        baseBranch: b.baseBranch ? String(b.baseBranch) : undefined,
        sandboxImage: b.sandboxImage ? String(b.sandboxImage) : undefined,
      });
      return { repo: review.listRepoSummaries().find((r) => r.id === repo.id) };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.patch('/api/review/repos/:id', async (req, reply) => {
    const u = requireAdmin(req, reply); if (!u) return;
    const { id } = req.params as any;
    if (!review.getRepo(id)) return reply.code(404).send({ error: 'not found' });
    const b = (req.body || {}) as any;
    try {
      await review.updateRepo(u, id, {
        name: b.name !== undefined ? String(b.name) : undefined,
        baseBranch: b.baseBranch !== undefined ? String(b.baseBranch) : undefined,
        sandboxImage: b.sandboxImage !== undefined ? String(b.sandboxImage) : undefined,
        credentialId: b.credentialId ? String(b.credentialId) : undefined,
      });
      return { repo: review.listRepoSummaries().find((r) => r.id === id) };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.post('/api/review/repos/:id/poll', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    if (!review.getRepo(id)) return reply.code(404).send({ error: 'not found' });
    try {
      const r = await review.pollRepo(id);
      return { ok: true, ...r };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/review/repos/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    if (!review.getRepo(id)) return reply.code(404).send({ error: 'not found' });
    review.deleteRepo(id);
    return { ok: true };
  });

  // ── review sessions (any authed user; visibility enforced) ──
  app.get('/api/review/sessions', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return { sessions: review.listReviewSessionsForUser(u) };
  });

  app.get('/api/review/sessions/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const rv = review.getReview(id);
    if (!rv) return reply.code(404).send({ error: 'not found' });
    const role = review.reviewRoleForChat(rv.chatSessionId, u);
    if (!role) return reply.code(403).send({ error: 'forbidden' });
    const repo = review.getRepo(rv.repoId);
    return {
      review: {
        id: rv.id, chatSessionId: rv.chatSessionId, prNumber: rv.prNumber, prTitle: rv.prTitle,
        prUrl: rv.prUrl, prState: rv.prState, authorLogin: rv.authorLogin, baseRef: rv.baseRef,
        headRef: rv.headRef, mergeState: rv.mergeState, mergedAt: rv.mergedAt,
        verdict: rv.verdict, verdictSummary: rv.verdictSummary,
      },
      repo: repo ? { id: repo.id, name: repo.name, provider: repo.provider, host: repo.host, slug: repo.slug } : null,
      role, // 'admin' (write) | 'reader' (read-only)
    };
  });

  app.post('/api/review/sessions/:id/merge', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    const rv = review.getReview(id);
    if (!rv) return reply.code(404).send({ error: 'not found' });
    try {
      const r = await review.localMerge(rv);
      return { ok: true, ...r };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // re-run the full automatic pipeline (local merge → build/run/review → verdict); fire-and-forget
  app.post('/api/review/sessions/:id/auto', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    const rv = review.getReview(id);
    if (!rv) return reply.code(404).send({ error: 'not found' });
    void review.autoReview(rv.id);
    return { ok: true };
  });

  // "지시 시 풀리퀘스트 허가": merge the PR on the remote using the merge-capable credential
  app.post('/api/review/sessions/:id/approve', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    const rv = review.getReview(id);
    if (!rv) return reply.code(404).send({ error: 'not found' });
    try {
      const r = await review.approvePr(rv);
      return { ok: true, ...r };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/review/sessions/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    const rv = review.getReview(id);
    if (!rv) return reply.code(404).send({ error: 'not found' });
    review.deleteReview(rv);
    return { ok: true };
  });
}
