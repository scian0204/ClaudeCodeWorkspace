import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  COOKIE, login, logout, requireAuth, requireAdmin, createUser, findByUsername,
  toAuthUser, hashPassword, authUserWithToken,
} from './index.js';
import { setUserToken, clearUserToken } from './claude-token.js';
import * as cs from '../codeserver/manager.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = (req.body || {}) as any;
    if (!username || !password) return reply.code(400).send({ error: 'username/password required' });
    const res = login(String(username), String(password));
    if (!res) return reply.code(401).send({ error: 'invalid credentials' });
    reply.setCookie(COOKIE, res.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 });
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

  // lightweight directory for any authed user (invite picker) — names only
  app.get("/api/users/directory", async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const rows = db.select().from(schema.users).all();
    return { users: rows.map((r) => ({ id: r.id, displayName: r.displayName, username: r.username, avatarColor: r.avatarColor })) };
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
