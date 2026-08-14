import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { cfg } from '../lib/config-registry.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { getUserToken } from './claude-token.js';
import { hasLogin } from './claude-login.js';

// ── shared-plan pools ("토큰 모아쓰기") ──
// Members join a pool to let the workspace run OTHER people's turns on their own Claude plan. A turn
// bound to a pool picks one member's credential; if that member's plan window turns out to be spent,
// the turn falls through to the next member instead of failing.
//
// SECURITY / consent: joining is always the member's own action (routes never let one user insert
// another's row). Removal is allowed for the member themselves, the pool's creator, and admins —
// taking someone out of a pool can only ever reduce what gets spent.

// Stored in chat_sessions.pool_id to mean "this session opts out — every sender pays for their own
// turns". Distinct from null, which means "inherit"; without it a session could never escape the
// workspace-wide pool. No generated pool id can collide with it.
export const POOL_OWN = 'own';

// The workspace-wide pool: NOT a named pool an admin picks, but "everyone in this workspace shares".
// It has no row in token_pools — its members are derived, every user who registered a plan and did
// not opt out. Reserved id, usable anywhere a pool id is (a session can name it explicitly).
export const POOL_ALL = 'all';
const ALL_CURSOR_KEY = 'token_pool_all_cursor'; // round-robin position for the derived pool

export function allUsersPoolOn(): boolean {
  return cfg.bool('tokenPoolEnabled') && cfg.bool('tokenPoolAllUsers');
}

// Everyone whose plan backs the workspace-wide pool. Opting out is a member's own switch: an admin
// turning the mode on must not be able to spend the plan of someone who declined.
export function allUsersMembers(): { userId: string; name: string }[] {
  return db.select({ id: schema.users.id, n: schema.users.displayName, out: schema.users.poolOptOut })
    .from(schema.users).all()
    .filter((u) => u.out !== 1 && hasCredential(u.id))
    .map((u) => ({ userId: u.id, name: u.n }));
}

export function setPoolOptOut(userId: string, optOut: boolean): void {
  db.update(schema.users).set({ poolOptOut: optOut ? 1 : 0 }).where(eq(schema.users.id, userId)).run();
}
export function poolOptOut(userId: string): boolean {
  return db.select({ o: schema.users.poolOptOut }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()?.o === 1;
}

export interface PoolMemberView {
  userId: string; name: string; priority: number;
  hasCredential: boolean;      // a Claude plan the server can actually run a turn with
  cooldownUntil: number;       // 0 = available
}
export interface PoolView {
  id: string; name: string; ownerId: string; ownerName: string;
  strategy: string; isGlobal: boolean; members: PoolMemberView[];
}

// ── credentials ──
// Which members can actually run a turn. A pasted per-user token or a browser sign-in both count; a
// per-user LLM-provider profile (bedrock/vertex/custom) counts too — it is pay-per-use, so it never
// runs out of window, which is exactly what a pool wants as a backstop.
export function hasCredential(userId: string): boolean {
  if (getUserToken(userId)) return true;
  if (hasLogin(userId)) return true;
  return !!db.select().from(schema.llmProviders)
    .where(and(eq(schema.llmProviders.scope, 'user'), eq(schema.llmProviders.ownerId, userId))).get();
}

// ── reads ──
function memberRows(poolId: string) {
  return db.select().from(schema.tokenPoolMembers).where(eq(schema.tokenPoolMembers.poolId, poolId)).all();
}

export function getPool(poolId: string) {
  return db.select().from(schema.tokenPools).where(eq(schema.tokenPools.id, poolId)).get();
}

export function listPools(): PoolView[] {
  const names = new Map(db.select({ id: schema.users.id, n: schema.users.displayName }).from(schema.users).all()
    .map((u) => [u.id, u.n] as const));
  const now = Date.now();
  // The derived workspace-wide pool leads the list when the mode is on. It has no row of its own, so
  // its cooldowns are read from token_pool_members rows keyed by POOL_ALL (written on exhaustion).
  const all: PoolView[] = [];
  if (allUsersPoolOn()) {
    const cools = new Map(memberRows(POOL_ALL).map((m) => [m.userId, m.cooldownUntil] as const));
    all.push({
      id: POOL_ALL, name: '', ownerId: '', ownerName: '',
      strategy: cfg.str('tokenPoolStrategy'), isGlobal: true,
      members: allUsersMembers().map((m): PoolMemberView => ({
        userId: m.userId, name: m.name, priority: 0, hasCredential: true,
        cooldownUntil: (cools.get(m.userId) || 0) > now ? cools.get(m.userId)! : 0,
      })),
    });
  }
  return all.concat(db.select().from(schema.tokenPools).all().map((p) => ({
    id: p.id, name: p.name, ownerId: p.ownerId, ownerName: names.get(p.ownerId) || '?',
    strategy: p.strategy || cfg.str('tokenPoolStrategy'), isGlobal: false,
    members: memberRows(p.id)
      .filter((m) => names.has(m.userId)) // a deleted user's leftover row is not a runnable member
      .sort((a, b) => a.priority - b.priority || a.joinedAt - b.joinedAt)
      .map((m): PoolMemberView => ({
        userId: m.userId, name: names.get(m.userId)!, priority: m.priority,
        hasCredential: hasCredential(m.userId),
        cooldownUntil: m.cooldownUntil > now ? m.cooldownUntil : 0,
      })),
  })));
}

// ── writes ──
export function createPool(name: string, ownerId: string, strategy = ''): string {
  const n = name.trim().slice(0, 60);
  if (!n) throw new Error('name required');
  const id = newId();
  db.insert(schema.tokenPools).values({
    id, name: n, ownerId, strategy: strategy === 'sequential' || strategy === 'rotate' ? strategy : '',
    cursor: 0, createdAt: Date.now(),
  }).run();
  return id;
}

export function deletePool(poolId: string): void {
  db.delete(schema.tokenPoolMembers).where(eq(schema.tokenPoolMembers.poolId, poolId)).run();
  db.delete(schema.tokenPools).where(eq(schema.tokenPools.id, poolId)).run();
  // sessions and users pointing at it fall back a level; the global binding itself is cleared
  db.update(schema.chatSessions).set({ poolId: null }).where(eq(schema.chatSessions.poolId, poolId)).run();
  db.update(schema.users).set({ defaultPoolId: null }).where(eq(schema.users.defaultPoolId, poolId)).run();
}

export function setStrategy(poolId: string, strategy: string): void {
  db.update(schema.tokenPools)
    .set({ strategy: strategy === 'sequential' || strategy === 'rotate' ? strategy : '' })
    .where(eq(schema.tokenPools.id, poolId)).run();
}

// Self-join only — the route passes the authenticated user's own id, never a body-supplied one.
export function join(poolId: string, userId: string): void {
  if (!getPool(poolId)) throw new Error('pool not found');
  db.insert(schema.tokenPoolMembers)
    .values({ poolId, userId, priority: 0, cooldownUntil: 0, joinedAt: Date.now() })
    .onConflictDoNothing().run();
}

export function leave(poolId: string, userId: string): void {
  db.delete(schema.tokenPoolMembers)
    .where(and(eq(schema.tokenPoolMembers.poolId, poolId), eq(schema.tokenPoolMembers.userId, userId))).run();
  // a pool you left can't stay your default (userDefaultPool re-checks anyway; this keeps the row honest)
  db.update(schema.users).set({ defaultPoolId: null })
    .where(and(eq(schema.users.id, userId), eq(schema.users.defaultPoolId, poolId))).run();
}

// A member's plan window came back exhausted → skip them until it reopens. `until` is the reset
// instant the CLI reported; without one, fall back to the configured cooldown.
export function markExhausted(poolId: string, userId: string, until?: number | null): void {
  const at = until && until > Date.now() ? until : Date.now() + cfg.int('tokenPoolCooldownMs');
  // The workspace-wide pool has no membership rows until someone's window runs out — insert on demand
  // so its cooldowns survive a restart like any other pool's.
  db.insert(schema.tokenPoolMembers)
    .values({ poolId, userId, priority: 0, cooldownUntil: at, joinedAt: Date.now() })
    .onConflictDoUpdate({
      target: [schema.tokenPoolMembers.poolId, schema.tokenPoolMembers.userId],
      set: { cooldownUntil: at },
    }).run();
}

// A member ran a turn successfully → their window is demonstrably open again.
export function markAvailable(poolId: string, userId: string): void {
  db.update(schema.tokenPoolMembers).set({ cooldownUntil: 0 })
    .where(and(eq(schema.tokenPoolMembers.poolId, poolId), eq(schema.tokenPoolMembers.userId, userId))).run();
}

// ── turn-time resolution ──
// Three levels, most specific first:
//   1. the session's own choice — a named pool, or POOL_OWN for "every sender pays for their own"
//   2. the sender's default pool (their party). Per USER, so two members of one shared room can draw
//      from different pools — that is what "each person uses their own arrangement" means.
//   3. the workspace-wide pool an admin set for every user.
// Returns null when pooling is off, the session opted out, or nothing is set at any level.
// A session naming a pool that no longer exists falls THROUGH rather than dropping off pooling:
// deletePool clears the bindings it knows about, but a row removed another way (a restore from an
// older backup, a manual DB edit) must not silently disable the feature for that session.
export function poolForSession(s: { poolId?: string | null }, authorId: string): string | null {
  if (!cfg.bool('tokenPoolEnabled')) return null;
  if (s.poolId === POOL_OWN) return null;
  if (s.poolId === POOL_ALL) return allUsersPoolOn() ? POOL_ALL : null;
  if (s.poolId && getPool(s.poolId)) return s.poolId;
  return userDefaultPool(authorId) ?? (allUsersPoolOn() ? POOL_ALL : null);
}

// The pool this user picked as their own default. Only counts while they are still a member —
// leaving a pool has to stop it backing their turns, whatever the stale column says.
export function userDefaultPool(userId: string): string | null {
  const id = db.select({ p: schema.users.defaultPoolId }).from(schema.users)
    .where(eq(schema.users.id, userId)).get()?.p;
  if (!id || !getPool(id)) return null;
  return isMember(id, userId) ? id : null;
}

// Set (or clear with null) the caller's own default pool. Joining stays a separate act: you can only
// default to a pool you already joined, so this can never enrol anyone.
export function setUserDefaultPool(userId: string, poolId: string | null): void {
  if (poolId) {
    if (!getPool(poolId)) throw new Error('pool not found');
    if (!isMember(poolId, userId)) throw new Error('join the pool first');
  }
  db.update(schema.users).set({ defaultPoolId: poolId }).where(eq(schema.users.id, userId)).run();
}

function isMember(poolId: string, userId: string): boolean {
  return !!db.select().from(schema.tokenPoolMembers)
    .where(and(eq(schema.tokenPoolMembers.poolId, poolId), eq(schema.tokenPoolMembers.userId, userId))).get();
}

// The order a turn should try credentials in. First entry runs; the rest are fallbacks for a spent
// plan window. Members on cooldown are pushed to the BACK rather than dropped: a stale cooldown
// (window reopened early, reset instant guessed) must never make a pool unusable.
// The sender is always last-resort so a pool with nothing available still runs their own turn.
export function runOrder(poolId: string, authorId: string): string[] {
  // The workspace-wide pool has no row: membership is derived from the user list, and its cooldowns
  // and round-robin position live in token_pool_members / settings instead.
  const isAll = poolId === POOL_ALL;
  const rows = isAll ? allUsersRows() : memberRows(poolId).filter((m) => hasCredential(m.userId));
  if (!rows.length) return [authorId];
  const cursor = isAll ? Number(getSetting(ALL_CURSOR_KEY, '0')) || 0 : getPool(poolId)!.cursor;
  const strategy = isAll ? cfg.str('tokenPoolStrategy') : (getPool(poolId)!.strategy || cfg.str('tokenPoolStrategy'));
  const order = orderFrom(rows, authorId, Date.now(), cursor, strategy);
  if (strategy === 'rotate') {
    const ready = rows.filter((m) => m.cooldownUntil <= Date.now()).length;
    if (ready > 1) {
      const next = (cursor + 1) % ready;
      if (isAll) setSetting(ALL_CURSOR_KEY, String(next));
      else db.update(schema.tokenPools).set({ cursor: next }).where(eq(schema.tokenPools.id, poolId)).run();
    }
  }
  return order;
}

// Derived rows for the workspace-wide pool, carrying whatever cooldown was recorded for each member.
function allUsersRows(): { userId: string; priority: number; cooldownUntil: number; joinedAt: number }[] {
  const cools = new Map(memberRows(POOL_ALL).map((m) => [m.userId, m.cooldownUntil] as const));
  return allUsersMembers().map((m, i) => ({
    userId: m.userId, priority: 0, cooldownUntil: cools.get(m.userId) || 0, joinedAt: i,
  }));
}

// Pure ordering — the only non-trivial logic in this module, so it is separated for the self-check.
export function orderFrom(
  rows: { userId: string; priority: number; cooldownUntil: number; joinedAt: number }[],
  authorId: string, now: number, cursor: number, strategy: string,
): string[] {
  const sorted = [...rows].sort((a, b) => a.priority - b.priority || a.joinedAt - b.joinedAt);
  const ready = sorted.filter((m) => m.cooldownUntil <= now).map((m) => m.userId);
  const cooling = sorted.filter((m) => m.cooldownUntil > now)
    .sort((a, b) => a.cooldownUntil - b.cooldownUntil).map((m) => m.userId);
  let order = ready;
  if (strategy === 'rotate' && ready.length > 1) {
    const start = ((cursor % ready.length) + ready.length) % ready.length;
    order = [...ready.slice(start), ...ready.slice(0, start)];
  }
  return [...new Set([...order, ...cooling, authorId])];
}

// ── reasoning self-check (run once: TOKEN_POOL_SELFCHECK=1 npx tsx server/src/auth/token-pool.ts) ──
if (process.env.TOKEN_POOL_SELFCHECK) {
  const assert = (cond: boolean, m: string) => { if (!cond) throw new Error('token-pool check failed: ' + m); };
  const now = 1_000_000;
  const rows = [
    { userId: 'a', priority: 0, cooldownUntil: 0, joinedAt: 1 },
    { userId: 'b', priority: 0, cooldownUntil: 0, joinedAt: 2 },
    { userId: 'c', priority: 0, cooldownUntil: now + 5000, joinedAt: 3 }, // window still shut
  ];
  assert(JSON.stringify(orderFrom(rows, 'z', now, 0, 'sequential')) === '["a","b","c","z"]', 'sequential: join order, spent members last');
  assert(JSON.stringify(orderFrom(rows, 'z', now, 1, 'rotate')) === '["b","a","c","z"]', 'rotate: cursor picks the starting member');
  assert(JSON.stringify(orderFrom(rows, 'a', now, 0, 'sequential')) === '["a","b","c"]', 'author already a member is not duplicated');
  assert(JSON.stringify(orderFrom([], 'z', now, 0, 'rotate')) === '["z"]', 'empty pool still runs the sender');
  // eslint-disable-next-line no-console
  console.log('token-pool.ts self-check ok');
}
