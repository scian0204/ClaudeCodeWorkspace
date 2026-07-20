import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { ensureRoomLayout } from '../lib/paths.js';
import { getUserById, toAuthUser, type AuthUser } from '../auth/index.js';

export type Perm = 'approve' | 'interrupt' | 'invite' | 'kick' | 'delete_room' | 'transfer';
export const DELEGABLE: Perm[] = ['approve', 'interrupt', 'invite', 'kick', 'delete_room', 'transfer'];
// NOT delegable: room permission-mode change (owner only) — enforced in canSetMode.

export function createRoom(owner: AuthUser, name: string) {
  const roomId = newId();
  const chatSessionId = newId();
  const now = Date.now();
  ensureRoomLayout(roomId);
  db.insert(schema.chatSessions).values({
    id: chatSessionId, ownerId: owner.id, kind: 'room', roomId, title: name,
    projectId: null, claudeSessionId: null, model: 'claude-opus-4-8',
    permissionMode: 'default', createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.rooms).values({
    id: roomId, name, ownerId: owner.id, chatSessionId, permissionMode: 'default', createdAt: now,
  }).run();
  db.insert(schema.roomMembers).values({ roomId, userId: owner.id, delegations: '[]', joinedAt: now }).run();
  return getRoom(roomId)!;
}

export function getRoom(roomId: string) {
  return db.select().from(schema.rooms).where(eq(schema.rooms.id, roomId)).get();
}

export function isMember(roomId: string, userId: string): boolean {
  return !!db.select().from(schema.roomMembers)
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId))).get();
}

export function memberRow(roomId: string, userId: string) {
  return db.select().from(schema.roomMembers)
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId))).get();
}

export function listRoomsForUser(u: AuthUser) {
  const all = db.select().from(schema.rooms).all();
  const visible = u.role === 'admin' ? all : all.filter((r) => isMember(r.id, u.id));
  return visible.map((r) => ({ ...r, members: getMembers(r.id) }));
}

export function getMembers(roomId: string) {
  const rows = db.select().from(schema.roomMembers).where(eq(schema.roomMembers.roomId, roomId))
    .orderBy(schema.roomMembers.joinedAt).all();
  const room = getRoom(roomId);
  return rows.map((m) => {
    const u = getUserById(m.userId);
    return {
      userId: m.userId,
      displayName: u?.displayName || '(deleted)',
      avatarColor: u?.avatarColor || '#888',
      username: u?.username || '',
      isOwner: room?.ownerId === m.userId,
      delegations: JSON.parse(m.delegations) as Perm[],
      joinedAt: m.joinedAt,
    };
  });
}

export function can(roomId: string, user: AuthUser, perm: Perm): boolean {
  const room = getRoom(roomId);
  if (!room) return false;
  if (user.role === 'admin') return true;         // admin overrides all rooms
  if (room.ownerId === user.id) return true;       // owner has everything
  const m = memberRow(roomId, user.id);
  if (!m) return false;
  return (JSON.parse(m.delegations) as Perm[]).includes(perm);
}

// permission-mode change: owner (or admin) only, never delegable
export function canSetMode(roomId: string, user: AuthUser): boolean {
  const room = getRoom(roomId);
  if (!room) return false;
  return user.role === 'admin' || room.ownerId === user.id;
}

export function addMember(roomId: string, userId: string) {
  if (isMember(roomId, userId)) return;
  db.insert(schema.roomMembers).values({ roomId, userId, delegations: '[]', joinedAt: Date.now() }).run();
}

export function removeMember(roomId: string, userId: string) {
  const room = getRoom(roomId);
  db.delete(schema.roomMembers)
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId))).run();
  // owner left -> oldest remaining member succeeds
  if (room && room.ownerId === userId) {
    const next = db.select().from(schema.roomMembers).where(eq(schema.roomMembers.roomId, roomId))
      .orderBy(schema.roomMembers.joinedAt).get();
    if (next) db.update(schema.rooms).set({ ownerId: next.userId }).where(eq(schema.rooms.id, roomId)).run();
  }
}

export function setDelegation(roomId: string, userId: string, perm: Perm, on: boolean) {
  const m = memberRow(roomId, userId);
  if (!m) return;
  const set = new Set(JSON.parse(m.delegations) as Perm[]);
  if (on) set.add(perm); else set.delete(perm);
  db.update(schema.roomMembers).set({ delegations: JSON.stringify([...set]) })
    .where(and(eq(schema.roomMembers.roomId, roomId), eq(schema.roomMembers.userId, userId))).run();
}

export function transferOwner(roomId: string, newOwnerId: string) {
  if (!isMember(roomId, newOwnerId)) addMember(roomId, newOwnerId);
  db.update(schema.rooms).set({ ownerId: newOwnerId }).where(eq(schema.rooms.id, roomId)).run();
}

export function setPermissionMode(roomId: string, mode: string) {
  db.update(schema.rooms).set({ permissionMode: mode }).where(eq(schema.rooms.id, roomId)).run();
  const room = getRoom(roomId);
  if (room) db.update(schema.chatSessions).set({ permissionMode: mode })
    .where(eq(schema.chatSessions.id, room.chatSessionId)).run();
}

export function deleteRoom(roomId: string) {
  const room = getRoom(roomId);
  db.delete(schema.roomMembers).where(eq(schema.roomMembers.roomId, roomId)).run();
  db.delete(schema.rooms).where(eq(schema.rooms.id, roomId)).run();
  if (room) {
    db.delete(schema.messages).where(eq(schema.messages.sessionId, room.chatSessionId)).run();
    db.delete(schema.chatSessions).where(eq(schema.chatSessions.id, room.chatSessionId)).run();
  }
}
