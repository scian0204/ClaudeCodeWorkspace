import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { encrypt, decrypt } from '../lib/secret-box.js';
import { newId, colorFor } from '../lib/ids.js';
import { ensureUserLayout } from '../lib/paths.js';
import type { Role } from './index.js';

// Shared plumbing for the two external directories (LDAP/AD and OIDC SSO).
//
// Both store ONE encrypted settings row (auth_providers, same shape as llm_providers) and both end
// at the same question: "this person proved who they are to an outside system — which local row is
// that?". `resolveDirectoryUser` is the single answer, so LDAP and OIDC cannot drift apart on the
// account-takeover rules that make it safe.
export type DirectoryKind = 'ldap' | 'oidc';

// ── settings row (secrets live inside the blob and never leave the server) ──
function row(kind: DirectoryKind) {
  return db.select().from(schema.authProviders).where(eq(schema.authProviders.kind, kind)).get();
}

export function getDirectoryConfig<T>(kind: DirectoryKind): T | null {
  const r = row(kind);
  if (!r) return null;
  try { return JSON.parse(decrypt(r.configEnc)) as T; }
  catch { return null; } // corrupt / re-keyed at rest → treat as unconfigured
}

export function setDirectoryConfig(kind: DirectoryKind, value: unknown): void {
  const now = Date.now();
  const existing = row(kind);
  const configEnc = encrypt(JSON.stringify(value));
  if (existing) db.update(schema.authProviders).set({ configEnc, updatedAt: now }).where(eq(schema.authProviders.id, existing.id)).run();
  else db.insert(schema.authProviders).values({ id: newId(), kind, configEnc, createdAt: now, updatedAt: now }).run();
}

export function clearDirectoryConfig(kind: DirectoryKind): void {
  db.delete(schema.authProviders).where(eq(schema.authProviders.kind, kind)).run();
}

// ── identity → local account ──

// What a directory tells us about the person who just authenticated.
export interface DirectoryIdentity {
  source: DirectoryKind;
  externalId: string;      // LDAP entry DN / OIDC `sub` — stable even when the username changes
  username: string;        // login name for the local row
  displayName: string;
  email?: string;
  admin?: boolean;         // the directory says this person is in the admin group
}

export interface ResolveOptions {
  jit: boolean;            // create a local row on first sign-in
  linkExisting: boolean;   // adopt an existing row that is NOT already ours (takeover — off by default)
  roleSync: boolean;       // let the directory's admin group set the role on every sign-in
}

export interface ResolveResult {
  user: typeof schema.users.$inferSelect;
  created: boolean;
  updated: boolean;
}

// Local login must be impossible for a directory account: no password is ever set for one, so the
// hash is random bytes nothing can produce. (verifyPassword just fails — there is no bypass branch.)
export function unusablePasswordHash(): string {
  return `${crypto.randomBytes(16).toString('hex')}:${crypto.randomBytes(32).toString('hex')}`;
}

// Login names come from someone else's directory, so they get the same treatment as any other
// outside string: lowercased, trimmed to the characters a local username may contain, length-capped.
export function normalizeUsername(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/[^a-z0-9._@-]+/g, '').slice(0, 64);
}

const byUsername = (u: string) => db.select().from(schema.users).where(eq(schema.users.username, u)).get();
const byExternal = (source: DirectoryKind, externalId: string) =>
  db.select().from(schema.users)
    .where(and(eq(schema.users.authSource, source), eq(schema.users.externalId, externalId))).get();

// Find (or make) the local row for an authenticated directory identity.
//
// Order matters, and every branch here is a security decision:
//  1. the row we already linked to this exact directory key — the normal path, even if the person
//     was renamed upstream (we re-find by DN/sub, not by name);
//  2. a row with that username that is ALREADY this directory's (an import created it before the
//     person ever signed in, or their DN moved) — adopt it and record the new key;
//  3. a row with that username belonging to someone else (a local account, or the other directory):
//     REFUSED unless an admin explicitly turned linkExisting on. This is the account-takeover guard —
//     without it, anyone who can create a user called `admin` in AD would inherit this workspace's
//     admin account;
//  4. nothing at all → create one, when JIT provisioning is on.
export function resolveDirectoryUser(idn: DirectoryIdentity, opts: ResolveOptions): ResolveResult {
  const username = normalizeUsername(idn.username);
  if (!username) throw new Error('directory account has no usable username');
  if (!idn.externalId) throw new Error('directory account has no stable id');
  const now = Date.now();
  const displayName = (idn.displayName || '').trim() || username;

  let existing = byExternal(idn.source, idn.externalId);
  let adopting = false;
  if (!existing) {
    const sameName = byUsername(username);
    if (sameName) {
      if (sameName.authSource === idn.source) { existing = sameName; adopting = true; }
      else if (opts.linkExisting) { existing = sameName; adopting = true; }
      else throw new Error(`username '${username}' already belongs to a ${sameName.authSource} account`);
    }
  }

  if (existing) {
    const patch: Record<string, unknown> = { externalSyncedAt: now };
    if (adopting) { patch.authSource = idn.source; patch.externalId = idn.externalId; }
    if (existing.username !== username) patch.username = username;
    if (existing.displayName !== displayName) patch.displayName = displayName;
    // Role sync only ever follows the directory when an admin asked for it, and it never demotes the
    // last admin — a mis-typed group DN would otherwise lock everyone out of the admin panel.
    if (opts.roleSync && idn.admin != null) {
      const want: Role = idn.admin ? 'admin' : 'member';
      if (want !== existing.role && !(want === 'member' && isLastAdmin(existing.id))) patch.role = want;
    }
    const changed = Object.keys(patch).length > 1;
    db.update(schema.users).set(patch).where(eq(schema.users.id, existing.id)).run();
    const fresh = db.select().from(schema.users).where(eq(schema.users.id, existing.id)).get()!;
    ensureUserLayout(fresh.id);
    return { user: fresh, created: false, updated: changed };
  }

  if (!opts.jit) throw new Error(`no local account for '${username}' (automatic account creation is off)`);

  const id = newId();
  db.insert(schema.users).values({
    id, username, passwordHash: unusablePasswordHash(),
    role: (opts.roleSync && idn.admin ? 'admin' : 'member') as Role,
    displayName, avatarColor: colorFor(id), createdAt: now,
    authSource: idn.source, externalId: idn.externalId, externalSyncedAt: now,
  }).run();
  ensureUserLayout(id);
  return { user: db.select().from(schema.users).where(eq(schema.users.id, id)).get()!, created: true, updated: false };
}

function isLastAdmin(userId: string): boolean {
  const admins = db.select().from(schema.users).where(eq(schema.users.role, 'admin')).all();
  return admins.length <= 1 && admins.some((a) => a.id === userId);
}
