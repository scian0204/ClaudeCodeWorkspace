import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { config } from './config.js';
import { cfg } from './lib/config-registry.js';
import { initDb } from './db/index.js';
import { bootstrapAdmin, attachUser } from './auth/index.js';
import { authRoutes } from './auth/routes.js';
import { sessionRoutes } from './routes/sessions.js';
import { roomRoutes } from './routes/rooms.js';
import { projectRoutes } from './routes/projects.js';
import { wikiRoutes, reapWikiStaging, reapWikiOrphans, refreshGroundingDocs } from './routes/wiki.js';
import { importRoutes, reapImportStaging } from './routes/import.js';
import { pluginRoutes } from './routes/plugins.js';
import { agentRoutes } from './routes/agents.js';
import { adminRoutes } from './routes/admin.js';
import { ssoRoutes } from './routes/sso.js';
import { reapBackupStaging } from './admin/backup.js';
import { gitCredentialRoutes } from './routes/git-credentials.js';
import { reviewRoutes } from './routes/review.js';
import { requestRoutes } from './routes/requests.js';
import { dmRoutes } from './routes/dm.js';
import { searchRoutes } from './routes/search.js';
import { brandRoutes } from './routes/brand.js';
import { guideRoutes } from './routes/guide.js';
import { startReviewPoller, reapReviewOrphans } from './review/manager.js';
import { scheduleModelRefresh } from './claude/models.js';
import { armPendingResumes } from './claude/auto-resume.js';
import { startWindowPrimer } from './claude/window-primer.js';
import { startLdapSync } from './auth/ldap.js';
import { cleanupSandboxOrphans } from './review/sandbox.js';
import { initRealtime } from './realtime/io.js';
import { startProjectWatch } from './watch/manager.js';
import { startReaper, cleanupOrphans, ensureNetwork } from './codeserver/manager.js';
import { removeAllSessionSandboxes, startReaper as startSessionSandboxReaper } from './claude/session-sandbox.js';
import { removeAllWinSandboxes, startWinReaper } from './claude/win-sandbox.js';
import { poolRoutes } from './routes/pools.js';
import { reconcileSelfUpdate, scheduleUpdateCheck } from './admin/self-update.js';
import { startDockerProbe } from './lib/docker-status.js';
import { isCsPath, handleHttp, handleUpgrade } from './codeserver/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  initDb();
  bootstrapAdmin();
  reapWikiStaging(); // clear any orphaned wiki upload staging from a prior run
  reapImportStaging(); // clear any orphaned session-import staging from a prior run
  reapWikiOrphans(); // remove wiki topic dirs on disk that no longer have a DB row
  refreshGroundingDocs(); // regenerate each topic's CLAUDE.md from its row (picks up rule changes)
  reapReviewOrphans(); // remove review clone/worktree dirs on disk that no longer have a DB row
  reapBackupStaging(); // clear backup/restore staging left by a crash (.pre-restore is kept — it's the rollback)

  // Serve HTTPS when a cert is supplied so PWA install works off-localhost (secure
  // context). socket.io and the /cs proxy both ride app.server, so this covers them.
  const tls =
    config.tlsKeyPath && config.tlsCertPath &&
    fs.existsSync(config.tlsKeyPath) && fs.existsSync(config.tlsCertPath)
      ? { key: fs.readFileSync(config.tlsKeyPath), cert: fs.readFileSync(config.tlsCertPath) }
      : null;
  const opts: FastifyServerOptions & { https?: { key: Buffer; cert: Buffer } } = {
    logger: false,
    bodyLimit: cfg.int('httpBodyLimitMB') * 1024 * 1024,
  };
  if (tls) opts.https = tls;
  const app = Fastify(opts);
  await app.register(cookie, { secret: config.sessionSecret });
  // fieldNameSize raised: wiki folder-drops carry each file's relative path in the field name
  await app.register(multipart, { limits: { fileSize: cfg.int('uploadMaxMB') * 1024 * 1024, fieldNameSize: 16384 } });

  // intercept code-server proxy before auth/routing (gated by random token per spec)
  app.addHook('onRequest', async (req, reply) => {
    if (isCsPath(req.url)) { handleHttp(req.raw, reply.raw); return reply.hijack(); }
    await attachUser(req);
  });

  await app.register(authRoutes);
  await app.register(sessionRoutes);
  await app.register(roomRoutes);
  await app.register(projectRoutes);
  await app.register(wikiRoutes);
  await app.register(importRoutes);
  await app.register(pluginRoutes);
  await app.register(agentRoutes);
  await app.register(adminRoutes);
  await app.register(ssoRoutes);
  await app.register(gitCredentialRoutes);
  await app.register(reviewRoutes);
  await app.register(requestRoutes);
  await app.register(dmRoutes);
  await app.register(searchRoutes);
  await app.register(brandRoutes);
  await app.register(guideRoutes);
  await app.register(poolRoutes);

  app.get('/api/health', async () => ({ ok: true, mock: cfg.bool('forceMock') }));

  // serve built SPA (production); in dev, Vite serves the frontend on :5173
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fstatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
      return reply.code(200).type('text/plain').send('web/dist not built. Run `npm run dev` (Vite on :5173) or `npm run build`.');
    });
  }

  const server = app.server;
  initRealtime(server);
  // route websocket upgrades: /cs/* -> code-server; /socket.io -> handled by its own listener
  server.on('upgrade', (req, socket, head) => {
    if (isCsPath(req.url)) handleUpgrade(req, socket, head as Buffer);
  });
  // probe the daemon first: editors, review sandboxes and self-update all need it, and the boot log +
  // admin banner + UI gating all read this one verdict (a failure here is logged, never fatal)
  await startDockerProbe().catch(() => {});
  await ensureNetwork(); // plain-`docker run` deploys: self-provision + join the code-server network
  await cleanupOrphans(); // clear orphans from a previous run
  await cleanupSandboxOrphans(); // clear leftover review build sandboxes from a previous run
  await removeAllSessionSandboxes(); // same for per-session build containers (registry is in-memory)
  await removeAllWinSandboxes().catch(() => {}); // and on the remote Windows host, if one is configured
  startReaper();
  startSessionSandboxReaper();
  startWinReaper();
  startProjectWatch(); // watch the projects sessions subscribed to for file changes (must follow initRealtime: it emits)
  startReviewPoller(); // poll each watched repo's host for open PRs → spawn/refresh review sessions
  scheduleModelRefresh(); // pull the live model list into the `models` config (frontier ids move fast)
  armPendingResumes(); // re-arm turns parked for a claude.ai window reset (must follow initRealtime: they emit)
  startWindowPrimer(); // keep opted-in users' claude.ai 5h window open so idle time isn't wasted
  startLdapSync(); // periodic AD/LDAP user import (off unless ldapSyncMs is set)
  void reconcileSelfUpdate().catch(() => {}); // decide how a self-update swap ended (we may BE the new image)
  scheduleUpdateCheck(); // periodic "is a newer image published" check (cache only — never auto-applies)

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[ccw] listening on ${tls ? 'https' : 'http'}://:${config.port}  forceMock=${cfg.bool('forceMock')}  data=${config.dataDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
