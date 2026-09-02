import crypto from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, schema } from '../db/index.js';
import { config } from '../config.js';
import { cfg } from '../lib/config-registry.js';
import { newId, newToken, colorFor } from '../lib/ids.js';
import { ensureUserLayout } from '../lib/paths.js';
import { setUserToken, userTokenMeta } from './claude-token.js';
import { hasLogin } from './claude-login.js';
import { getProvider } from './provider.js';
import { resolveDirectoryUser, type DirectoryKind } from './directory.js';
import { parseSchedule, type PrimerSchedule } from '../lib/primer-schedule.js';
import { ldapAuthenticate, ldapReady } from './ldap.js';

// auth session lifetime is configurable (sessionTtlDays); resolved live at login()

export type Role = 'admin' | 'member';
export interface AuthUser {
  id: string; username: string; role: Role; displayName: string; avatarColor: string;
  avatar: string | null; // avatar version token (cache-bust key) or null when unset
  autoTitle: boolean;    // name a fresh private chat after its topic on the first turn
  autoResume: boolean;   // re-run a turn that hit the claude.ai 5h window, once it resets
  primeWindow: boolean;  // open a fresh claude.ai 5h window with a tiny query as soon as none runs
  primedAt: number | null; // when the primer last opened one (epoch ms), null = never
  primeWindowSched: PrimerSchedule | null; // when it may run (clock times / allowed range); null = continuous
  authSource: 'local' | DirectoryKind; // who owns this account's password (local scrypt / AD / SSO)
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
  username: string; password: string; role?: Role; displayName?: string; claudeToken?: string;
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
  if (opts.claudeToken) setUserToken(id, opts.claudeToken); // throws on bad format
  return { id, username: row.username, role: row.role, displayName: row.displayName, avatarColor: row.avatarColor, avatar: null, autoTitle: true, autoResume: false, primeWindow: false, primedAt: null, primeWindowSched: null, authSource: 'local' };
}

export function findByUsername(username: string) {
  return db.select().from(schema.users).where(eq(schema.users.username, username)).get();
}
export function getUserById(id: string) {
  return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}
export function toAuthUser(u: NonNullable<ReturnType<typeof getUserById>>): AuthUser {
  return { id: u.id, username: u.username, role: u.role as Role, displayName: u.displayName, avatarColor: u.avatarColor, avatar: u.avatar ?? null, autoTitle: u.autoTitle !== 0, autoResume: u.autoResume === 1, primeWindow: u.primeWindow === 1, primedAt: u.primedAt ?? null, primeWindowSched: parseSchedule(u.primeWindowSched), authSource: (u.authSource as 'local' | DirectoryKind) || 'local' };
}

// Does this user's own provider profile actually carry auth? An `anthropic` profile with no token
// is the "just use my Claude token" case — resolveProvider falls straight through it, so it must
// not count as auth here either, or the nag would go quiet for someone who still has none.
function hasOwnProvider(userId: string): boolean {
  const p = getProvider('user', userId);
  if (!p) return false;
  return p.type !== 'anthropic' || p.fields.hasAuthToken || p.fields.hasApiKey;
}

// AuthUser + Claude-auth status (for /me and /login so the client can drive the nag popup).
// hasClaudeToken is specifically "a token is pasted" (what the token form itself reports), while
// hasClaudeAuth answers the only question the nag actually cares about: can this user's turns run?
// A browser sign-in or an LLM provider profile (bedrock/vertex/local via a custom base URL) is
// perfectly good auth, so nagging those users for a token is wrong — same three sources
// resolveProvider walks for the user scope.
export function authUserWithToken(u: AuthUser) {
  const m = userTokenMeta(u.id);
  return {
    ...u,
    hasClaudeToken: m.hasToken,
    claudeTokenSetAt: m.setAt,
    hasClaudeAuth: m.hasToken || hasLogin(u.id) || hasOwnProvider(u.id),
  };
}

// Mint the cookie session for an already-authenticated user. Every sign-in path ends here — the
// local form, an LDAP bind, an OIDC callback — so session lifetime and shape stay in one place.
export function issueSession(u: NonNullable<ReturnType<typeof getUserById>>): { token: string; user: AuthUser } {
  const token = newToken();
  const now = Date.now();
  db.insert(schema.authSessions).values({ id: token, userId: u.id, createdAt: now, expiresAt: now + cfg.int('sessionTtlDays') * 86_400_000 }).run();
  return { token, user: toAuthUser(u) };
}

// Turning localLoginEnabled off hides the username/password form once a directory is in place, but
// it never applies to admins: an SSO outage must not lock the workspace's own operators out.
function localFormAllowed(u: { role: string }): boolean {
  return cfg.bool('localLoginEnabled') || u.role === 'admin';
}

// The username/password form.
//
// The account's own `authSource` decides who checks the password, and there is deliberately no
// fallback between the two: a row marked 'local' is checked ONLY against its scrypt hash (so an
// `admin` object appearing in AD cannot sign in as this workspace's admin), and a row owned by a
// directory is checked ONLY by that directory (so a stale local hash cannot outlive a disabled AD
// account). A name with no row at all goes to LDAP, which is where first-time sign-ins come from.
export async function login(username: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
  const name = String(username);
  const existing = findByUsername(name);
  if (existing && existing.authSource === 'local') {
    if (!localFormAllowed(existing)) return null;
    return verifyPassword(password, existing.passwordHash) ? issueSession(existing) : null;
  }
  if ((!existing || existing.authSource === 'ldap') && ldapReady()) {
    try {
      const identity = await ldapAuthenticate(name, password);
      if (!identity) return null;
      const r = resolveDirectoryUser(identity, {
        jit: cfg.bool('ldapJitEnabled'),
        linkExisting: cfg.bool('ldapLinkExisting'),
        roleSync: cfg.bool('ldapRoleSync'),
      });
      return issueSession(r.user);
    } catch (e: any) {
      // Provisioning refusals (name already taken locally) and unreachable-server errors are for the
      // operator, not the login form — the browser only ever learns "invalid credentials".
      console.warn('[ldap] login failed:', String(e?.message || e));
      return null;
    }
  }
  return null;
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
