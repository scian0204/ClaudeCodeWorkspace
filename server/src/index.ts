import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { bootstrapAdmin, attachUser } from './auth/index.js';
import { authRoutes } from './auth/routes.js';
import { sessionRoutes } from './routes/sessions.js';
import { roomRoutes } from './routes/rooms.js';
import { projectRoutes } from './routes/projects.js';
import { wikiRoutes, reapWikiStaging, reapWikiOrphans } from './routes/wiki.js';
import { pluginRoutes } from './routes/plugins.js';
import { adminRoutes } from './routes/admin.js';
import { initRealtime } from './realtime/io.js';
import { startReaper, cleanupOrphans } from './codeserver/manager.js';
import { isCsPath, handleHttp, handleUpgrade } from './codeserver/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  initDb();
  bootstrapAdmin();
  reapWikiStaging(); // clear any orphaned wiki upload staging from a prior run
  reapWikiOrphans(); // remove wiki topic dirs on disk that no longer have a DB row

  const app = Fastify({ logger: false, bodyLimit: 6 * 1024 * 1024 });
  await app.register(cookie, { secret: config.sessionSecret });
  // fieldNameSize raised: wiki folder-drops carry each file's relative path in the field name
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, fieldNameSize: 16384 } });

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
  await app.register(pluginRoutes);
  await app.register(adminRoutes);

  app.get('/api/health', async () => ({ ok: true, mock: config.mockClaude }));

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
  await cleanupOrphans(); // clear orphans from a previous run
  startReaper();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  console.log(`[ccw] listening on :${config.port}  mock=${config.mockClaude}  data=${config.dataDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
