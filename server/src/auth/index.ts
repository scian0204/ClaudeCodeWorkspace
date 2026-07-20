import crypto from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { newId, newToken, colorFor } from '../lib/ids.js';
import { ensureUserLayout } from '../lib/paths.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Role = 'admin' | 'member';
export interface AuthUser {
  id: string; username: string; role: Role; displayName: string; avatarColor: string;
}

// ── password hashing (stdlib scrypt; lightweight posture per spec) ──
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  const a = Buffer.from(hashHex, 'hex');
  return a.length === hash.length && crypto.timingSafeEqual(a, hash);
}

export function createUser(opts: {
  username: string; password: string; role?: Role; displayName?: string;
}): AuthUser {
  const id = newId();
  const row = {
    id, username: opts.username, passwordHash: hashPassword(opts.password),
    role: (opts.role || 'member') as Role,
    displayName: opts.displayName || opts.username,
    avatarColor: colorFor(id), createdAt: Date.now(),
  };
  db.insert(schema.users).values(row).run();
  ensureUserLayout(id);
  return { id, username: row.username, role: row.role, displayName: row.displayName, avatarColor: row.avatarColor };
}

export function findByUsername(username: string) {
  return db.select().from(schema.users).where(eq(schema.users.username, username)).get();
}
export function getUserById(id: string) {
  return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}
export function toAuthUser(u: NonNullable<ReturnType<typeof getUserById>>): AuthUser {
  return { id: u.id, username: u.username, role: u.role as Role, displayName: u.displayName, avatarColor: u.avatarColor };
}

export function login(username: string, password: string): { token: string; user: AuthUser } | null {
  const u = findByUsername(username);
  if (!u || !verifyPassword(password, u.passwordHash)) return null;
  const token = newToken();
  const now = Date.now();
  db.insert(schema.authSessions).values({ id: token, userId: u.id, createdAt: now, expiresAt: now + SESSION_TTL_MS }).run();
  return { token, user: toAuthUser(u) };
}

export function logout(token: string) {
  db.delete(schema.authSessions).where(eq(schema.authSessions.id, token)).run();
}

export function userForToken(token: string | undefined): AuthUser | null {
  if (!token) return null;
  const s = db.select().from(schema.authSessions)
    .where(and(eq(schema.authSessions.id, token), gt(schema.authSessions.expiresAt, Date.now()))).get();
  if (!s) return null;
  const u = getUserById(s.userId);
  return u ? toAuthUser(u) : null;
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export const COOKIE = 'ccw_sid';

// ── fastify hooks ──
declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser; }
}

export async function attachUser(req: FastifyRequest) {
  const token = parseCookie(req.headers.cookie, COOKIE);
  const u = userForToken(token);
  if (u) req.user = u;
}

export function requireAuth(req: FastifyRequest, reply: FastifyReply): AuthUser | null {
  if (!req.user) { reply.code(401).send({ error: 'unauthenticated' }); return null; }
  return req.user;
}
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const u = requireAuth(req, reply);
  if (!u) return null;
  if (u.role !== 'admin') { reply.code(403).send({ error: 'forbidden' }); return null; }
  return u;
}

export function bootstrapAdmin() {
  const count = db.select().from(schema.users).all().length;
  if (count > 0) return;
  createUser({
    username: config.bootstrapAdminUser, password: config.bootstrapAdminPassword,
    role: 'admin', displayName: config.bootstrapAdminUser,
  });
  console.log(`[auth] bootstrapped admin '${config.bootstrapAdminUser}' (change the password!)`);
}
