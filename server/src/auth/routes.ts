import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import {
  COOKIE, login, logout, requireAuth, requireAdmin, createUser, findByUsername,
  toAuthUser, hashPassword,
} from './index.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = (req.body || {}) as any;
    if (!username || !password) return reply.code(400).send({ error: 'username/password required' });
    const res = login(String(username), String(password));
    if (!res) return reply.code(401).send({ error: 'invalid credentials' });
    reply.setCookie(COOKIE, res.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 24 * 3600 });
    return { user: res.user };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE];
    if (token) logout(token);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    return { user: u };
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
    const { username, password, role, displayName } = (req.body || {}) as any;
    if (!username || !password) return reply.code(400).send({ error: 'username/password required' });
    if (findByUsername(String(username))) return reply.code(409).send({ error: 'username taken' });
    const u = createUser({
      username: String(username), password: String(password),
      role: role === 'admin' ? 'admin' : 'member', displayName: displayName ? String(displayName) : undefined,
    });
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
