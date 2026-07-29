import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  COOKIE, login, logout, requireAuth, requireAdmin, createUser, findByUsername,
  toAuthUser, hashPassword, authUserWithToken, getUserById,
} from './index.js';
import { setUserToken, clearUserToken } from './claude-token.js';
import { getProvider, setProvider, clearProvider } from './provider.js';
import * as cs from '../codeserver/manager.js';
import { cfg, publicConfig } from '../lib/config-registry.js';
import { paths, ensureUserLayout } from '../lib/paths.js';

// Avatar storage: image saved on disk at <userHome>/avatar.<ext>; the users.avatar column holds a
// version token (set-time millis) for cache-busting. Extension is derived from the validated mime
// type — the client-supplied filename is never used for the on-disk path.
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const AVATAR_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
function avatarFile(uid: string): string | null {
  for (const ext of AVATAR_EXTS) {
    const f = path.join(paths.userHome(uid), `avatar.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
function removeAvatarFiles(uid: string) {
  for (const ext of AVATAR_EXTS) {
    try { fs.rmSync(path.join(paths.userHome(uid), `avatar.${ext}`), { force: true }); } catch { /* noop */ }
  }
}
function meDto(uid: string) { const u = getUserById(uid); return u ? authUserWithToken(toAuthUser(u)) : null; }

// Verify the buffer's leading bytes match the claimed image type — defends against a spoofed mime
// on a non-image payload. No dependency; ext comes from MIME_EXT so it's png/jpg/webp/gif.
function magicOk(ext: string, b: Buffer): boolean {
  if (ext === 'png') return b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === 'jpg' || ext === 'jpeg') return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === 'gif') return b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
  if (ext === 'webp') return b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return false;
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = (req.body || {}) as any;
    if (!username || !password) return reply.code(400).send({ error: 'username/password required' });
    const res = login(String(username), String(password));
    if (!res) return reply.code(401).send({ error: 'invalid credentials' });
    reply.setCookie(COOKIE, res.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: cfg.int('sessionTtlDays') * 86_400 });
    return { user: authUserWithToken(res.user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) logout(token);
    reply.clearCookie(COOKIE, { path: '/' });
    if (req.user) cs.killForOwner(req.user.id).catch(() => {}); // remove editors on logout
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return { user: authUserWithToken(u) };
  });

  // client-facing config subset (drives the model dropdown) — any authed user
  app.get('/api/config', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return publicConfig();
  });

  // ── self-service Claude token (register / update / clear) ──
  app.put('/api/auth/me/claude-token', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { token } = (req.body || {}) as any;
    if (!token) return reply.code(400).send({ error: 'token required' });
    try { setUserToken(u.id, String(token)); }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return { user: authUserWithToken(u) };
  });

  app.delete('/api/auth/me/claude-token', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    clearUserToken(u.id);
    return { user: authUserWithToken(u) };
  });

  // ── self-service LLM provider override (get status / set / clear) — never returns secrets ──
  app.get('/api/auth/me/provider', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    return { provider: getProvider('user', u.id) };
  });
  app.put('/api/auth/me/provider', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    const { type, config } = (req.body || {}) as any;
    try { return { provider: setProvider('user', u.id, type, config) }; }
    catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
  app.delete('/api/auth/me/provider', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    if (!cfg.bool('llmProvidersEnabled')) return reply.code(404).send({ error: 'llm providers disabled' });
    clearProvider('user', u.id);
    return { provider: null };
  });

  // ── self-service avatar (upload / remove) — multipart single image ──
  app.post('/api/auth/me/avatar', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const maxMB = cfg.int('avatarMaxMB'); // must stay ≤ httpBodyLimitMB (global body cap) to take effect
    const data = await (req as any).file({ limits: { fileSize: maxMB * 1024 * 1024 } }); // cap at the streaming layer
    if (!data) return reply.code(400).send({ error: 'no image uploaded' });
    const ext = MIME_EXT[data.mimetype];
    if (!ext) { data.file.resume(); return reply.code(400).send({ error: 'unsupported image type (png/jpeg/webp/gif only)' }); } // drain without buffering
    let buf: Buffer;
    try { buf = await data.toBuffer(); } // fileSize limit throws RequestFileTooLargeError on overflow
    catch { return reply.code(413).send({ error: `image too large (max ${maxMB}MB)` }); }
    if (data.file.truncated) return reply.code(413).send({ error: `image too large (max ${maxMB}MB)` }); // belt-and-suspenders
    if (!magicOk(ext, buf)) return reply.code(400).send({ error: 'file content does not match an image type' });
    ensureUserLayout(u.id);
    // Write the new file FIRST; only after it lands drop any *other-extension* prior avatar (never the
    // one we just wrote) — so a write failure can't leave a has-avatar DB row pointing at no file.
    const home = paths.userHome(u.id);
    fs.writeFileSync(path.join(home, `avatar.${ext}`), buf);
    for (const old of AVATAR_EXTS) {
      if (old === ext) continue;
      try { fs.rmSync(path.join(home, `avatar.${old}`), { force: true }); } catch { /* noop */ }
    }
    db.update(schema.users).set({ avatar: String(Date.now()) }).where(eq(schema.users.id, u.id)).run();
    const dto = meDto(u.id); if (!dto) return reply.code(404).send({ error: 'user not found' });
    return { user: dto };
  });

  app.delete('/api/auth/me/avatar', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    removeAvatarFiles(u.id);
    db.update(schema.users).set({ avatar: null }).where(eq(schema.users.id, u.id)).run();
    const dto = meDto(u.id); if (!dto) return reply.code(404).send({ error: 'user not found' });
    return { user: dto };
  });

  // stream any user's avatar (so room members / directory avatars render too). Authed-only.
  // Lookup is by exact user id → a non-existent/traversal id simply misses the DB row (404),
  // so the id never reaches the filesystem path unless it's a real user.
  app.get('/api/users/:id/avatar', async (req, reply) => {
    const me = requireAuth(req, reply); if (!me) return;
    const { id } = req.params as any;
    const row = getUserById(String(id));
    if (!row || !row.avatar) return reply.code(404).send({ error: 'no avatar' });
    const f = avatarFile(String(id));
    if (!f) return reply.code(404).send({ error: 'no avatar' });
    reply.header('Content-Type', EXT_MIME[f.split('.').pop()!.toLowerCase()] || 'application/octet-stream');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(fs.createReadStream(f));
  });

  // lightweight directory for any authed user (invite picker) — names only
  app.get("/api/users/directory", async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const rows = db.select().from(schema.users).all();
    return { users: rows.map((r) => ({ id: r.id, displayName: r.displayName, username: r.username, avatarColor: r.avatarColor, avatar: r.avatar ?? null })) };
  });

  // ── user provisioning (admin) ──
  app.get('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const rows = db.select().from(schema.users).all();
    return { users: rows.map(toAuthUser) };
  });

  app.post('/api/users', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { username, password, role, displayName, claudeToken } = (req.body || {}) as any;
    if (!username || !password) return reply.code(400).send({ error: 'username/password required' });
    if (findByUsername(String(username))) return reply.code(409).send({ error: 'username taken' });
    let u;
    try {
      u = createUser({
        username: String(username), password: String(password),
        role: role === 'admin' ? 'admin' : 'member', displayName: displayName ? String(displayName) : undefined,
        claudeToken: claudeToken ? String(claudeToken) : undefined,
      });
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
    return { user: u };
  });

  app.post('/api/users/:id/password', async (req, reply) => {
    const me = requireAuth(req, reply); if (!me) return;
    const { id } = req.params as any;
    const { password } = (req.body || {}) as any;
    if (me.role !== 'admin' && me.id !== id) return reply.code(403).send({ error: 'forbidden' });
    if (!password) return reply.code(400).send({ error: 'password required' });
    db.update(schema.users).set({ passwordHash: hashPassword(String(password)) }).where(eq(schema.users.id, id)).run();
    return { ok: true };
  });

  app.delete('/api/users/:id', async (req, reply) => {
    const admin = requireAdmin(req, reply); if (!admin) return;
    const { id } = req.params as any;
    if (id === admin.id) return reply.code(400).send({ error: 'cannot delete self' });
    db.delete(schema.authSessions).where(eq(schema.authSessions.userId, id)).run();
    db.delete(schema.users).where(eq(schema.users.id, id)).run();
    return { ok: true };
  });
}
