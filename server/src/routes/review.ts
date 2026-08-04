import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../auth/index.js';
import { cfg } from '../lib/config-registry.js';
import * as review from '../review/manager.js';
import { verifyHook, isPrEvent } from '../review/webhook.js';

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
    // UI hides the option when webhooks are off; a request asking for one anyway is refused, not
    // silently downgraded to a repo whose hook never fires.
    if (b.webhook && !cfg.bool('reviewWebhook'))
      return reply.code(403).send({ error: '웹훅이 비활성화되어 있습니다 (관리자 설정)' });
    try {
      const repo = await review.createRepo(u, {
        name: b.name ? String(b.name) : undefined, gitUrl: String(b.gitUrl),
        credentialId: String(b.credentialId), provider: b.provider ? String(b.provider) : undefined,
        baseBranch: b.baseBranch ? String(b.baseBranch) : undefined,
        sandboxImage: b.sandboxImage ? String(b.sandboxImage) : undefined,
        webhook: !!b.webhook,
        pollEnabled: b.pollEnabled !== undefined ? !!b.pollEnabled : undefined,
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
        pollEnabled: b.pollEnabled !== undefined ? !!b.pollEnabled : undefined,
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

  // Issue / rotate / clear this repo's inbound webhook secret. The response is the only place the
  // full secret is handed out at issue time; it stays readable to admins via the repos listing so a
  // hook can be reconfigured later without rotating (which would break the provider's deliveries).
  app.post('/api/review/repos/:id/webhook', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('reviewWebhook')) return reply.code(403).send({ error: '웹훅이 비활성화되어 있습니다 (관리자 설정)' });
    const { id } = req.params as any;
    if (!review.getRepo(id)) return reply.code(404).send({ error: 'not found' });
    const enabled = (req.body || {}) as any;
    try {
      const secret = review.setWebhook(id, !!enabled.enabled);
      return { ok: true, secret };
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

  // ── inbound provider webhook (no session auth — authenticated by the per-repo secret) ──
  // Registered in its own scope so the raw-body parser (GitHub signs the exact bytes, so a
  // re-serialized object would never match) applies here only and leaves the JSON routes above
  // untouched. The poll runs fire-and-forget: providers time out a webhook in seconds, and a poll
  // does a git fetch + host API call.
  await app.register(async (hook) => {
    hook.removeContentTypeParser(['application/json']);
    hook.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => { done(null, body); });

    hook.post('/api/review/hooks/:id', async (req, reply) => {
      if (!cfg.bool('reviewWebhook')) return reply.code(404).send({ error: 'not found' });
      const { id } = req.params as any;
      const repo = review.getRepo(id);
      // no secret set = this repo's endpoint is off; 404 either way so the URL leaks nothing
      if (!repo || !repo.webhookSecret) return reply.code(404).send({ error: 'not found' });
      const q = (req.query || {}) as any;
      const raw = typeof req.body === 'string' ? req.body : '';
      if (!verifyHook(repo.webhookSecret, raw, req.headers as any, q.token ? String(q.token) : undefined))
        return reply.code(401).send({ error: 'unauthorized' });
      if (!isPrEvent(req.headers as any)) return { ok: true, ignored: true };
      void review.pollRepo(id).catch(() => { /* error recorded on the repo row */ });
      return { ok: true, queued: true };
    });
  });
}
