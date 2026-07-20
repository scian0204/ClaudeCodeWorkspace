import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { parseCookie, userForToken, COOKIE, type AuthUser } from '../auth/index.js';
import { enqueueTurn, cancelQueued, queueState, setEmitFactory } from '../rooms/queue.js';
import { interruptTurn } from '../claude/session-manager.js';
import { respondPermission, pendingForSession, type Decision } from '../claude/permissions.js';
import * as rooms from '../rooms/manager.js';

export let io: IOServer;

function sessionRoom(id: string) { return `session:${id}`; }

function getChat(sessionId: string) {
  return db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, sessionId)).get();
}

// access + control authority for a session
function access(user: AuthUser, sessionId: string) {
  const s = getChat(sessionId);
  if (!s) return null;
  if (s.kind === 'room') {
    const roomId = s.roomId!;
    if (user.role !== 'admin' && !rooms.isMember(roomId, user.id)) return null;
    return { s, kind: 'room' as const, roomId };
  }
  if (user.role !== 'admin' && s.ownerId !== user.id) return null;
  return { s, kind: 'private' as const, roomId: null };
}

async function presence(sessionId: string) {
  const sockets = await io.in(sessionRoom(sessionId)).fetchSockets();
  const seen = new Map<string, AuthUser>();
  for (const s of sockets) { const u = (s.data as any).user as AuthUser; if (u) seen.set(u.id, u); }
  io.to(sessionRoom(sessionId)).emit('presence:update', {
    sessionId, users: [...seen.values()].map((u) => ({ id: u.id, name: u.displayName, color: u.avatarColor })),
  });
}

export function initRealtime(httpServer: HttpServer) {
  io = new IOServer(httpServer, { path: '/socket.io', maxHttpBufferSize: 5e6 });

  // emit factory so the FIFO queue / session manager can broadcast to session rooms
  setEmitFactory((sessionId) => (event, payload) => io.to(sessionRoom(sessionId)).emit(event, payload));

  io.use((socket, next) => {
    const token = parseCookie(socket.handshake.headers.cookie, COOKIE);
    const u = userForToken(token);
    if (!u) return next(new Error('unauthenticated'));
    (socket.data as any).user = u;
    next();
  });

  io.on('connection', (socket) => {
    const user = (socket.data as any).user as AuthUser;

    socket.on('session:join', async (sessionId: string, ack?: Function) => {
      const a = access(user, sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      socket.join(sessionRoom(sessionId));
      const state = {
        queue: queueState(sessionId),
        pending: pendingForSession(sessionId),
        control: controlInfo(user, a),
      };
      ack?.(state);
      await presence(sessionId);
    });

    socket.on('session:leave', async (sessionId: string) => {
      socket.leave(sessionRoom(sessionId));
      await presence(sessionId);
    });

    socket.on('chat:send', (p: { sessionId: string; text: string }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      if (!p.text?.trim()) { ack?.({ error: 'empty' }); return; }
      const itemId = enqueueTurn(p.sessionId, { id: user.id, name: user.displayName }, p.text.trim());
      ack?.({ itemId });
    });

    socket.on('chat:cancel', (p: { sessionId: string; itemId: string }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      const item = queueState(p.sessionId).waiting.find((w) => w.id === p.itemId);
      const allowed = item?.author.id === user.id
        || (a.kind === 'room' ? rooms.can(a.roomId!, user, 'interrupt') : a.s.ownerId === user.id || user.role === 'admin');
      if (!allowed) { ack?.({ error: 'forbidden' }); return; }
      ack?.({ ok: cancelQueued(p.sessionId, p.itemId) });
    });

    socket.on('chat:interrupt', (p: { sessionId: string }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      const allowed = a.kind === 'room' ? rooms.can(a.roomId!, user, 'interrupt')
        : (a.s.ownerId === user.id || user.role === 'admin');
      if (!allowed) { ack?.({ error: 'forbidden' }); return; }
      ack?.({ ok: interruptTurn(p.sessionId) });
    });

    socket.on('permission:respond', (p: { sessionId: string; requestId: string; decision: Decision }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      const allowed = a.kind === 'room' ? rooms.can(a.roomId!, user, 'approve')
        : (a.s.ownerId === user.id || user.role === 'admin');
      if (!allowed) { ack?.({ error: 'forbidden' }); return; }
      const ok = respondPermission(p.requestId, p.decision);
      io.to(sessionRoom(p.sessionId)).emit('permission:answered', {
        sessionId: p.sessionId, requestId: p.requestId, decision: p.decision, by: user.displayName,
      });
      ack?.({ ok });
    });

    socket.on('disconnecting', () => {
      for (const r of socket.rooms) {
        if (r.startsWith('session:')) setTimeout(() => presence(r.slice('session:'.length)), 50);
      }
    });
  });

  return io;
}

function controlInfo(user: AuthUser, a: NonNullable<ReturnType<typeof access>>) {
  if (a.kind === 'private') {
    return { canApprove: true, canInterrupt: true, canSetMode: true, isOwner: true, delegable: [] as string[] };
  }
  const roomId = a.roomId!;
  return {
    canApprove: rooms.can(roomId, user, 'approve'),
    canInterrupt: rooms.can(roomId, user, 'interrupt'),
    canSetMode: rooms.canSetMode(roomId, user),
    isOwner: rooms.getRoom(roomId)?.ownerId === user.id || user.role === 'admin',
    delegable: rooms.DELEGABLE,
  };
}
