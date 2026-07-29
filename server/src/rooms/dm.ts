// Direct messages + group chat: a lightweight human-to-human text layer, fully separate from the
// Claude "rooms" (shared workspaces). No Claude turns, no queue — just person-to-person / group
// text over Socket.IO. Every read/write here is membership-gated; promote-to-room is admin-only
// (enforced in the route via requireAdmin).
import { and, eq, gt, lt, ne, desc } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { getUserById, toAuthUser } from '../auth/index.js';
import * as rooms from './manager.js';

export const MAX_DM_LEN = 4000; // ponytail: hard cap per message; raise if long pastes matter

export interface DmMemberInfo { userId: string; displayName: string; avatarColor: string; avatar: string | null; username: string; }
export interface DmChannelSummary {
  id: string; kind: string; name: string | null; createdBy: string; createdAt: number;
  members: DmMemberInfo[];
  lastMessage: { text: string; createdAt: number; userId: string } | null;
  unread: number;
}
export interface DmMessageRow { id: string; channelId: string; userId: string; text: string; createdAt: number; }

function getChannel(channelId: string) {
  return db.select().from(schema.dmChannels).where(eq(schema.dmChannels.id, channelId)).get();
}

export function isMember(channelId: string, userId: string): boolean {
  return !!db.select().from(schema.dmMembers)
    .where(and(eq(schema.dmMembers.channelId, channelId), eq(schema.dmMembers.userId, userId))).get();
}

export function channelIdsForUser(userId: string): string[] {
  return db.select({ id: schema.dmMembers.channelId }).from(schema.dmMembers)
    .where(eq(schema.dmMembers.userId, userId)).all().map((r) => r.id);
}

export function memberIds(channelId: string): string[] {
  return db.select({ id: schema.dmMembers.userId }).from(schema.dmMembers)
    .where(eq(schema.dmMembers.channelId, channelId)).all().map((r) => r.id);
}

function memberInfos(channelId: string): DmMemberInfo[] {
  return memberIds(channelId).map((uid) => {
    const u = getUserById(uid);
    return {
      userId: uid,
      displayName: u?.displayName || '(deleted)',
      avatarColor: u?.avatarColor || '#888',
      avatar: u?.avatar ?? null,
      username: u?.username || '',
    };
  });
}

// Build the per-viewer summary (members + last message + unread relative to their lastReadAt).
function summary(channelId: string, userId: string): DmChannelSummary | null {
  const ch = getChannel(channelId);
  if (!ch) return null;
  const me = db.select().from(schema.dmMembers)
    .where(and(eq(schema.dmMembers.channelId, channelId), eq(schema.dmMembers.userId, userId))).get();
  const lastReadAt = me?.lastReadAt ?? 0;
  const last = db.select().from(schema.dmMessages).where(eq(schema.dmMessages.channelId, channelId))
    .orderBy(desc(schema.dmMessages.createdAt)).limit(1).get();
  // unread = messages newer than my lastReadAt that I didn't write. Channels are small; scan-count.
  // ponytail: .all().length count (matches repo style); swap to SQL count() if channels get huge.
  const unread = db.select({ id: schema.dmMessages.id }).from(schema.dmMessages)
    .where(and(
      eq(schema.dmMessages.channelId, channelId),
      gt(schema.dmMessages.createdAt, lastReadAt),
      ne(schema.dmMessages.userId, userId),
    )).all().length;
  return {
    id: ch.id, kind: ch.kind, name: ch.name, createdBy: ch.createdBy, createdAt: ch.createdAt,
    members: memberInfos(channelId),
    lastMessage: last ? { text: last.text, createdAt: last.createdAt, userId: last.userId } : null,
    unread,
  };
}

// Channels the user belongs to, most-recently-active first.
export function listChannels(userId: string): DmChannelSummary[] {
  return channelIdsForUser(userId)
    .map((id) => summary(id, userId))
    .filter((c): c is DmChannelSummary => !!c)
    .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt) - (a.lastMessage?.createdAt ?? a.createdAt));
}

// Find-or-create the 1:1 channel between two users (deduped: a DM between the same pair is reused).
export function createDm(userId: string, otherUserId: string): DmChannelSummary {
  if (userId === otherUserId) throw new Error('cannot DM yourself');
  if (!getUserById(otherUserId)) throw new Error('unknown user');
  for (const id of channelIdsForUser(userId)) {
    const ch = getChannel(id);
    if (ch?.kind !== 'dm') continue;
    const mids = memberIds(id);
    if (mids.length === 2 && mids.includes(otherUserId)) return summary(id, userId)!; // reuse
  }
  const id = newId();
  const now = Date.now();
  db.insert(schema.dmChannels).values({ id, kind: 'dm', name: null, createdBy: userId, createdAt: now }).run();
  db.insert(schema.dmMembers).values([
    { channelId: id, userId, lastReadAt: now },
    { channelId: id, userId: otherUserId, lastReadAt: 0 },
  ]).run();
  return summary(id, userId)!;
}

export function createGroup(userId: string, name: string, invitees: string[]): DmChannelSummary {
  const clean = (name || '').trim();
  if (!clean) throw new Error('name required');
  const uniq = [...new Set([userId, ...invitees])].filter((uid) => !!getUserById(uid));
  const id = newId();
  const now = Date.now();
  db.insert(schema.dmChannels).values({ id, kind: 'group', name: clean, createdBy: userId, createdAt: now }).run();
  db.insert(schema.dmMembers).values(uniq.map((uid) => ({ channelId: id, userId: uid, lastReadAt: uid === userId ? now : 0 }))).run();
  return summary(id, userId)!;
}

// Insert a message (membership-gated, length-capped). Returns the row, or null if not a member / empty.
export function postMessage(channelId: string, userId: string, text: string): DmMessageRow | null {
  if (!isMember(channelId, userId)) return null;
  const clean = (text || '').trim().slice(0, MAX_DM_LEN);
  if (!clean) return null;
  const row: DmMessageRow = { id: newId(), channelId, userId, text: clean, createdAt: Date.now() };
  db.insert(schema.dmMessages).values(row).run();
  return row;
}

// Paginated history, newest-last. `before` is a createdAt cursor (older page). null = not a member.
export function listMessages(channelId: string, userId: string, before?: number): DmMessageRow[] | null {
  if (!isMember(channelId, userId)) return null;
  const PAGE = 50;
  const where = before
    ? and(eq(schema.dmMessages.channelId, channelId), lt(schema.dmMessages.createdAt, before))
    : eq(schema.dmMessages.channelId, channelId);
  const rows = db.select().from(schema.dmMessages).where(where)
    .orderBy(desc(schema.dmMessages.createdAt)).limit(PAGE).all();
  return rows.reverse().map((m) => ({ id: m.id, channelId: m.channelId, userId: m.userId, text: m.text, createdAt: m.createdAt }));
}

export function markRead(channelId: string, userId: string): void {
  db.update(schema.dmMembers).set({ lastReadAt: Date.now() })
    .where(and(eq(schema.dmMembers.channelId, channelId), eq(schema.dmMembers.userId, userId))).run();
}

// Admin-only (route gates via requireAdmin): spin up a common project room seeded with the group's
// members, reusing rooms.createRoom + addMember. Only group channels can be promoted.
export function promoteToRoom(channelId: string, adminId: string): string {
  const ch = getChannel(channelId);
  if (!ch) throw new Error('channel not found');
  if (ch.kind !== 'group') throw new Error('only group channels can be promoted');
  const admin = getUserById(adminId);
  if (!admin) throw new Error('unknown admin');
  const room = rooms.createRoom(toAuthUser(admin), ch.name || 'Group');
  for (const uid of memberIds(channelId)) rooms.addMember(room.id, uid);
  return room.id;
}
