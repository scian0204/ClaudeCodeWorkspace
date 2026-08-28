import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../auth/index.js';
import { db, schema } from '../db/index.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { cfg, listConfigForApi, setConfigValue, resetConfigValue, imageConfigValues, imageHostFor } from '../lib/config-registry.js';
import { inspectImage, pullImage } from '../lib/docker-images.js';
import { probeWinDocker, winDockerStatus, winDocker } from '../lib/docker-hosts.js';
import { scanResources, runCleanup } from '../admin/cleanup.js';
import { listProcesses, controlProcess } from '../admin/processes.js';
import { appVersion, cachedStatus, checkForUpdate, updateStatus, applyUpdate } from '../admin/self-update.js';
import { createBackupStream, backupFilename, stageRestore, restoreStatus, discardRestore, applyRestore } from '../admin/backup.js';
import { dockerStatus, probeDocker } from '../lib/docker-status.js';
import { turnLimiter } from '../claude/throttle.js';
import { setCommonToken, clearCommonToken, commonTokenMeta } from '../auth/claude-token.js';
import { startLogin, submitCode, cancelLogin, logoutLogin, loginMeta, loginInFlight, COMMON as COMMON_LOGIN } from '../auth/claude-login.js';
import { getProvider, setProvider, clearProvider } from '../auth/provider.js';
import { refreshModels } from '../claude/models.js';

// Which daemon an image-typed setting points at. Only ever called with a value that already passed
// the imageConfigValues() allowlist, so this cannot be steered at an arbitrary host.
function hostFor(image: string) {
  return imageHostFor(image) === 'windows' ? (winDocker() || undefined) : undefined;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return {
      users: db.select().from(schema.users).all().length,
      rooms: db.select().from(schema.rooms).all().length,
      sessions: db.select().from(schema.chatSessions).all().length,
      throttle: { max: turnLimiter.max, inUse: turnLimiter.inUse, waiting: turnLimiter.waiting },
      forceMock: cfg.bool('forceMock'),
      commonToken: commonTokenMeta(), // shared fallback status (admin-set DB token or env)
      commonLogin: loginMeta(COMMON_LOGIN), // the other shared fallback: an admin's signed-in account
      // version + "newer image published" banner, from the LAST check only (never a fetch here).
      // latest/newerVersion ride along so the panel's banner can name the target version and tell a
      // version bump from a rebuilt image on the same tag.
      version: appVersion(),
      updateAvailable: !!cachedStatus()?.updateAvailable,
      updateLatest: cachedStatus()?.latest || null,
      updateNewerVersion: !!cachedStatus()?.newerVersion,
      // daemon reachability: editors, review sandboxes and self-update all hang off it, so the panel
      // warns up front with the real reason instead of letting each feature fail on use
      docker: dockerStatus(),
    };
  });

  // re-probe on demand (an admin who just fixed the socket mount shouldn't wait for the interval)
  app.post('/api/admin/docker/probe', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { docker: await probeDocker() };
  });

  app.get('/api/admin/settings', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return {
      allowBypass: getSetting('allow_bypass', '1') === '1',
      commonToken: commonTokenMeta(),
    };
  });

  app.post('/api/admin/settings', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = (req.body || {}) as any;
    if ('allowBypass' in b) setSetting('allow_bypass', b.allowBypass ? '1' : '0');
    return { ok: true };
  });

  // ── full config registry: every admin-manageable setting (env + hardcoded constants) ──
  app.get('/api/admin/config', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { items: listConfigForApi() };
  });
  app.put('/api/admin/config', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { key, value } = (req.body || {}) as any;
    if (!key) return reply.code(400).send({ error: 'key required' });
    try { setConfigValue(String(key), value); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return { items: listConfigForApi() };
  });
  // pull the live model list from the provider's /v1/models into the `models` config (frontier ids
  // change often); returns the refreshed registry so the panel re-renders like any other edit
  app.post('/api/admin/models/refresh', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { return { models: await refreshModels(), items: listConfigForApi() }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.delete('/api/admin/config/:key', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { key } = req.params as any;
    try { resetConfigValue(String(key)); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return { items: listConfigForApi() };
  });

  // ── docker image management for image-typed settings (code-server / review sandbox) ──
  // Allowlisted to the current values of image-typed settings so an admin can only act on images
  // the app actually uses (never an arbitrary pull via the mounted socket).
  app.post('/api/admin/image/inspect', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const image = String((req.body as any)?.image || '');
    if (!imageConfigValues().includes(image)) return reply.code(400).send({ error: 'unknown image' });
    return inspectImage(image, hostFor(image));
  });
  app.post('/api/admin/image/pull', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const image = String((req.body as any)?.image || '');
    if (!imageConfigValues().includes(image)) return reply.code(400).send({ error: 'unknown image' });
    try { await pullImage(image, hostFor(image)); }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e).slice(0, 300) }); }
    return inspectImage(image, hostFor(image));
  });

  // ── remote Windows build host: reachability + "is it really a Windows daemon" ──
  // GET is the cached verdict (cheap, for rendering); POST re-probes on the admin's click.
  app.get('/api/admin/windows-docker', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { windows: winDockerStatus() };
  });
  app.post('/api/admin/windows-docker/test', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { windows: await probeWinDocker() };
  });

  // ── resource cleanup (spawned containers / dangling images / orphaned dirs+rows) ──
  // Read-only scan on GET; destructive actions on POST. Both gated by resourceCleanupEnabled — the
  // server is the real gate (UI hiding is cosmetic). Scans never delete; actions only ever touch
  // app-spawned containers, dangling images, and genuine orphans — never live user data.
  app.get('/api/admin/cleanup', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('resourceCleanupEnabled')) return { enabled: false };
    try { return { enabled: true, ...(await scanResources()) }; }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e).slice(0, 300) }); }
  });
  app.post('/api/admin/cleanup', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('resourceCleanupEnabled')) return reply.code(403).send({ error: 'resource cleanup disabled' });
    const action = String((req.body as any)?.action || '');
    try {
      const summary = await runCleanup(action);
      return { enabled: true, summary, ...(await scanResources()) };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // ── activity / processes: live view over running/queued turns, editor+sandbox containers, and
  // running review pipelines, with per-item controls (stop turn / cancel queued / kill container). ──
  app.get('/api/admin/processes', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { return await listProcesses(); }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e).slice(0, 300) }); }
  });
  app.post('/api/admin/processes', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const b = (req.body || {}) as any;
    try {
      await controlProcess(String(b.kind || ''), String(b.action || ''), {
        sessionId: b.sessionId, itemId: b.itemId, id: b.id, chatSessionId: b.chatSessionId,
      });
      return await listProcesses();
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // ── self-update: version check against the published image + container swap ──
  // Gated by selfUpdateEnabled on the server (UI hiding is cosmetic). Apply only ever pulls OUR own
  // repo (the tag is validated in applyUpdate) and rolls back automatically if the new image is bad.
  app.get('/api/admin/update', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { return await updateStatus(); }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e).slice(0, 300) }); }
  });
  app.post('/api/admin/update/check', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('selfUpdateEnabled')) return reply.code(403).send({ error: 'self-update disabled' });
    try { return await checkForUpdate(); }
    catch (e: any) { return reply.code(500).send({ error: String(e?.message || e).slice(0, 300) }); }
  });
  app.post('/api/admin/update/apply', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('selfUpdateEnabled')) return reply.code(403).send({ error: 'self-update disabled' });
    const tag = (req.body as any)?.tag;
    try { return await applyUpdate(tag ? String(tag) : undefined); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e).slice(0, 300) }); }
  });

  // ── restart the server process; docker's restart policy (unless-stopped) brings it back ──
  app.post('/api/admin/restart', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    setTimeout(() => { console.log('[ccw] admin-triggered restart'); process.exit(0); }, 300);
    return { ok: true };
  });

  // ── whole-workspace backup & restore (server migration) ──
  // The archive is a credential dump (CLI credential files, password hashes) — admin only, and
  // gated server-side by backupEnabled per rule 10.
  const backupOff = (reply: any) =>
    cfg.bool('backupEnabled') ? false : (reply.code(403).send({ error: 'backup/restore is disabled' }), true);
  app.get('/api/admin/backup', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (backupOff(reply)) return;
    try {
      const stream = createBackupStream();
      reply.header('Content-Type', 'application/gzip');
      reply.header('Content-Disposition', `attachment; filename="${backupFilename()}"`);
      return reply.send(stream);
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
  app.post('/api/admin/restore/upload', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (backupOff(reply)) return;
    try { return { summary: await stageRestore(req) }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e).slice(0, 300) }); }
  });
  app.get('/api/admin/restore', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (backupOff(reply)) return;
    return { summary: restoreStatus() };
  });
  app.delete('/api/admin/restore', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (backupOff(reply)) return;
    discardRestore();
    return { ok: true };
  });
  app.post('/api/admin/restore/apply', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (backupOff(reply)) return;
    try { return applyRestore(); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  // ── admin-managed common (shared) Claude token ──
  app.get('/api/admin/claude-token', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { commonToken: commonTokenMeta() };
  });
  app.put('/api/admin/claude-token', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { token } = (req.body || {}) as any;
    if (!token) return reply.code(400).send({ error: 'token required' });
    try { setCommonToken(String(token)); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return { commonToken: commonTokenMeta() };
  });
  app.delete('/api/admin/claude-token', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    clearCommonToken();
    return { commonToken: commonTokenMeta() };
  });

  // ── shared account by sign-in, the alternative to pasting a common token ──
  // Same two-step flow as the per-user one, but the credential lands in the common home. A turn
  // that falls back to it gets CLAUDE_SECURESTORAGE_CONFIG_DIR (see resolveProvider), so the
  // borrowing user keeps their own HOME. A pasted common token still wins if one is set.
  const loginGate = (reply: any) => {
    if (cfg.bool('claudeLoginEnabled')) return true;
    reply.code(404).send({ error: 'claude login disabled' });
    return false;
  };

  app.get('/api/admin/claude-login', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!loginGate(reply)) return;
    return { login: loginMeta(COMMON_LOGIN), pendingUrl: loginInFlight(COMMON_LOGIN) };
  });
  app.post('/api/admin/claude-login/start', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!loginGate(reply)) return;
    try { return { ...(await startLogin(COMMON_LOGIN)) }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
  app.post('/api/admin/claude-login/code', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!loginGate(reply)) return;
    const { code } = (req.body || {}) as any;
    if (!code || typeof code !== 'string') return reply.code(400).send({ error: 'code required' });
    try { return { login: await submitCode(COMMON_LOGIN, code) }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
  app.delete('/api/admin/claude-login/start', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    cancelLogin(COMMON_LOGIN);
    return { ok: true };
  });
  app.delete('/api/admin/claude-login', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await logoutLogin(COMMON_LOGIN);
    return { login: loginMeta(COMMON_LOGIN) };
  });

  // ── admin-managed common LLM provider override (shared fallback) — never returns secrets ──
  app.get('/api/admin/provider', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    return { provider: getProvider('common', '') };
  });
  app.put('/api/admin/provider', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    const { type, config } = (req.body || {}) as any;
    try { return { provider: setProvider('common', '', type, config) }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
  app.delete('/api/admin/provider', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    clearProvider('common', '');
    return { provider: null };
  });
}
