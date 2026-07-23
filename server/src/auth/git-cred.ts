import fs from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { encrypt, decrypt } from '../lib/secret-box.js';
import { getSetting } from '../lib/settings.js';
import { paths, ensure } from '../lib/paths.js';
import { newId } from '../lib/ids.js';

export type GitProvider = 'github' | 'gitlab' | 'bitbucket' | 'other';
export type GitScope = 'user' | 'common';

// meta returned to clients — the token is NEVER included
export interface GitCredMeta {
  id: string; scope: GitScope; provider: GitProvider; host: string;
  username: string; authorEmail: string | null; setAt: number;
}
export interface ResolvedGitCred { username: string; token: string; authorName: string | null; authorEmail: string | null; }

const COMMON_OWNER = ''; // common creds use '' so the (scope, owner_id, host) unique index holds

const PROVIDERS: GitProvider[] = ['github', 'gitlab', 'bitbucket', 'other'];
function normProvider(p: any): GitProvider { return PROVIDERS.includes(p) ? p : 'other'; }

function toMeta(r: typeof schema.gitCredentials.$inferSelect): GitCredMeta {
  return { id: r.id, scope: r.scope as GitScope, provider: r.provider as GitProvider, host: r.host,
    username: r.username, authorEmail: r.authorEmail ?? null, setAt: r.createdAt };
}

// Extract the host from any supported remote URL (https/git/ssh/scp-like git@host:path).
export function hostFromGitUrl(url: string): string | null {
  const u = (url || '').trim();
  let m = u.match(/^[a-zA-Z]+:\/\/(?:[^/@]+@)?([^/:]+)/); // scheme://[user@]host[:port]/...
  if (m) return m[1].toLowerCase();
  m = u.match(/^[^@\s]+@([^:/\s]+):/); // git@host:path
  if (m) return m[1].toLowerCase();
  return null;
}

function normToken(t: string): string {
  const s = (t || '').trim();
  if (s.length < 8) throw new Error('invalid token (too short)');
  return s;
}

function listMeta(scope: GitScope, ownerId: string): GitCredMeta[] {
  return db.select().from(schema.gitCredentials)
    .where(and(eq(schema.gitCredentials.scope, scope), eq(schema.gitCredentials.ownerId, ownerId)))
    .all().map(toMeta);
}
export function listUserGitCreds(userId: string): GitCredMeta[] { return listMeta('user', userId); }
export function listCommonGitCreds(): GitCredMeta[] { return listMeta('common', COMMON_OWNER); }

// Create or update (by scope+owner+host) a credential. Returns meta (no token).
export function addGitCred(p: {
  scope: GitScope; ownerId: string; provider: any; host: string; username: string;
  token: string; authorName?: string; authorEmail?: string;
}): GitCredMeta {
  const host = (p.host || '').trim().toLowerCase();
  if (!host) throw new Error('host required');
  const username = (p.username || '').trim();
  if (!username) throw new Error('username required');
  const ownerId = p.scope === 'common' ? COMMON_OWNER : p.ownerId;
  const vals = {
    provider: normProvider(p.provider), username, tokenEnc: encrypt(normToken(p.token)),
    authorName: p.authorName?.trim() || null, authorEmail: p.authorEmail?.trim() || null,
  };
  const existing = db.select().from(schema.gitCredentials).where(and(
    eq(schema.gitCredentials.scope, p.scope), eq(schema.gitCredentials.ownerId, ownerId),
    eq(schema.gitCredentials.host, host))).get();
  if (existing) {
    db.update(schema.gitCredentials).set(vals).where(eq(schema.gitCredentials.id, existing.id)).run();
    return toMeta({ ...existing, ...vals });
  }
  const row = { id: newId(), scope: p.scope, ownerId, host, createdAt: Date.now(), ...vals };
  db.insert(schema.gitCredentials).values(row).run();
  return toMeta(row);
}

export function getGitCredRow(id: string) {
  return db.select().from(schema.gitCredentials).where(eq(schema.gitCredentials.id, id)).get();
}
export function deleteGitCred(id: string): void {
  db.delete(schema.gitCredentials).where(eq(schema.gitCredentials.id, id)).run();
}

function decryptRow(r: typeof schema.gitCredentials.$inferSelect | undefined): ResolvedGitCred | null {
  if (!r) return null;
  try { return { username: r.username, token: decrypt(r.tokenEnc), authorName: r.authorName ?? null, authorEmail: r.authorEmail ?? null }; }
  catch { return null; } // corrupt/rekeyed → treat as no credential
}

// Pick the row that authenticates a host: the user's own first, else the admin common one.
function resolveGitCredRow(userId: string | null, host: string | null) {
  const h = (host || '').toLowerCase();
  if (!h) return undefined;
  const pick = (scope: GitScope, owner: string) => db.select().from(schema.gitCredentials).where(and(
    eq(schema.gitCredentials.scope, scope), eq(schema.gitCredentials.ownerId, owner),
    eq(schema.gitCredentials.host, h))).get();
  return (userId ? pick('user', userId) : undefined) ?? pick('common', COMMON_OWNER);
}

// Resolve the credential for a host (decrypted token, server-side only).
export function resolveGitCred(userId: string | null, host: string | null): ResolvedGitCred | null {
  return decryptRow(resolveGitCredRow(userId, host));
}

// Same resolution, but meta only (no token) — safe to send to clients so the UI can show
// which credential a repo's push/commit will actually use, and whether it's yours or the shared one.
export function resolveGitCredMeta(userId: string | null, host: string | null): GitCredMeta | null {
  const row = resolveGitCredRow(userId, host);
  return row ? toMeta(row) : null;
}

// Resolve one specific credential by id (explicit clone picker). Access is checked by the caller.
export function resolveGitCredById(id: string): ResolvedGitCred | null {
  return decryptRow(getGitCredRow(id));
}

// Git author identity for a user, honoring an optional per-credential override.
export function gitIdentity(user: { username: string; displayName: string }, cred?: ResolvedGitCred | null): { name: string; email: string } {
  const domain = getSetting('git_author_domain', 'ccw.local');
  const name = cred?.authorName || user.displayName || user.username;
  const email = cred?.authorEmail || `${user.username}@${domain}`;
  return { name, email };
}

// ── askpass helper: a static script that echoes the token from env (never on disk / in URL) ──
let askpassPath = '';
export function ensureAskpass(): string {
  if (askpassPath && fs.existsSync(askpassPath)) return askpassPath;
  const dir = path.join(paths.root, '.gitcred');
  ensure(dir);
  const p = path.join(dir, 'askpass.sh');
  const script = [
    '#!/bin/sh',
    'case "$1" in',
    "  Username*) printf '%s' \"$GIT_CRED_USERNAME\" ;;",
    "  *) printf '%s' \"$GIT_CRED_PASSWORD\" ;;",
    'esac',
    '',
  ].join('\n');
  fs.writeFileSync(p, script, { mode: 0o700 });
  try { fs.chmodSync(p, 0o700); } catch { /* noop */ }
  askpassPath = p;
  return p;
}

// Env that authenticates a git child as this credential. Secret stays in process memory only.
export function askpassEnv(cred: ResolvedGitCred): Record<string, string> {
  return {
    GIT_ASKPASS: ensureAskpass(),
    GIT_TERMINAL_PROMPT: '0',
    GIT_CRED_USERNAME: cred.username || 'x-access-token',
    GIT_CRED_PASSWORD: cred.token,
  };
}

// Git author/committer identity env for a commit.
export function identityEnv(id: { name: string; email: string }): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email,
    GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email,
  };
}
