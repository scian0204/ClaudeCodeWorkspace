import type { Server as HttpServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { parseCookie, userForToken, COOKIE, type AuthUser } from '../auth/index.js';
import { enqueueTurn, cancelQueued, queueState, setEmitFactory } from '../rooms/queue.js';
import { interruptTurn, liveTurn, postChat } from '../claude/session-manager.js';
import { isSlashCommand } from '../claude/prompt.js';
import { tasksFor } from '../claude/tasks.js';
import { pendingForSession as resumesForSession, cancelResume } from '../claude/auto-resume.js';
import { respondPermission, pendingForSession, type Decision } from '../claude/permissions.js';
import * as rooms from '../rooms/manager.js';
import * as review from '../review/manager.js';
import * as dm from '../rooms/dm.js';
import { cfg } from '../lib/config-registry.js';
import { isBareBasename } from '../lib/attachments.js';

export let io: IOServer;

function sessionRoom(id: string) { return `session:${id}`; }
function dmRoom(id: string) { return `dm:${id}`; }
function userRoom(id: string) { return `user:${id}`; } // per-user room: fan out DM joins/nudges to all a user's tabs

// Called from the DM routes when a channel is created / a member is added: pull every listed user's
// live sockets into the channel room so they receive dm:message without reconnecting.
export function dmJoinUsers(channelId: string, userIds: string[]) {
  if (!io) return;
  for (const uid of userIds) io.in(userRoom(uid)).socketsJoin(dmRoom(channelId));
}
// Light "your channel list changed" ping (new channel / unread reset) so a user's other tabs refresh.
export function dmNudge(userIds: string[]) {
  if (!io) return;
  for (const uid of userIds) io.to(userRoom(uid)).emit('dm:channels');
}
// Push to every tab of one user, for work that finishes after the HTTP response and belongs to no
// session room the client has joined (e.g. titling the chats a local-session import just created).
export function emitToUser(userId: string, event: string, payload: any) {
  if (!io) return;
  io.to(userRoom(userId)).emit(event, payload);
}

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
    return { s, kind: 'room' as const, roomId, canWrite: true };
  }
  if (s.kind === 'review') {
    // admin = full access; the PR author = read-only (can watch the stream, can't send/approve)
    const role = review.reviewRoleForChat(s.id, user);
    if (!role) return null;
    return { s, kind: 'review' as const, roomId: null, canWrite: role === 'admin' };
  }
  if (user.role !== 'admin' && s.ownerId !== user.id) return null;
  return { s, kind: 'private' as const, roomId: null, canWrite: true };
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
  io = new IOServer(httpServer, { path: '/socket.io', maxHttpBufferSize: cfg.int('socketMaxMB') * 1024 * 1024 });

  // emit factory so the FIFO queue / session manager can broadcast to session rooms
  setEmitFactory((sessionId) => (event, payload) => io.to(sessionRoom(sessionId)).emit(event, payload));

  // review poller / merge broadcast a "lists changed" ping so every client refreshes its review lists
  review.setReviewBroadcast(() => io.emit('review:changed'));

  io.use((socket, next) => {
    const token = parseCookie(socket.handshake.headers.cookie, COOKIE);
    const u = userForToken(token);
    if (!u) return next(new Error('unauthenticated'));
    (socket.data as any).user = u;
    next();
  });

  io.on('connection', (socket) => {
    const user = (socket.data as any).user as AuthUser;

    // Per-user room + auto-join every DM/group channel the user belongs to (re-runs on reconnect).
    socket.join(userRoom(user.id));
    if (cfg.bool('dmEnabled')) for (const id of dm.channelIdsForUser(user.id)) socket.join(dmRoom(id));

    // ── DM / group chat (pure human text; never routed through the Claude turn/queue path) ──
    // Payload TS types are compile-time only — a raw socket client can send anything, so coerce to
    // strings before any DB/trim use. A non-string would throw inside socket.io's dispatch (uncaught,
    // no global uncaughtException handler) = whole-process crash reachable by any authed user.
    socket.on('dm:send', (p: any, ack?: Function) => {
      if (!cfg.bool('dmEnabled')) { ack?.({ error: 'disabled' }); return; }
      const channelId = typeof p?.channelId === 'string' ? p.channelId : '';
      if (!channelId || !dm.isMember(channelId, user.id)) { ack?.({ error: 'no access' }); return; }
      const message = dm.postMessage(channelId, user.id, typeof p?.text === 'string' ? p.text : ''); // re-validates membership + caps length
      if (!message) { ack?.({ error: 'empty' }); return; }
      io.to(dmRoom(channelId)).emit('dm:message', { channelId, message });
      ack?.({ ok: true });
    });

    socket.on('dm:read', (p: any) => {
      if (!cfg.bool('dmEnabled')) return;
      const channelId = typeof p?.channelId === 'string' ? p.channelId : '';
      if (!channelId || !dm.isMember(channelId, user.id)) return;
      dm.markRead(channelId, user.id);
      io.to(userRoom(user.id)).emit('dm:channels'); // other tabs refresh unread
    });

    socket.on('session:join', async (sessionId: string, ack?: Function) => {
      const a = access(user, sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      socket.join(sessionRoom(sessionId));
      const state = {
        queue: queueState(sessionId),
        pending: pendingForSession(sessionId),
        control: controlInfo(user, a),
        live: liveTurn(sessionId), // replay in-flight turn progress to a mid-turn joiner
        resumes: resumesForSession(sessionId), // turns parked until the claude.ai window resets
        tasks: tasksFor(sessionId), // subagents / background shells / workflows this session spawned
      };
      ack?.(state);
      await presence(sessionId);
    });

    socket.on('session:leave', async (sessionId: string) => {
      socket.leave(sessionRoom(sessionId));
      await presence(sessionId);
    });

    socket.on('chat:send', (p: { sessionId: string; text: string; chat?: boolean; includeChat?: boolean; attachments?: { name: string; isImage: boolean }[] }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      if (!a.canWrite) { ack?.({ error: 'read-only' }); return; } // review PR author can't send
      // accept only well-formed attachment refs (bare basename + bool); runTurn re-validates on disk.
      // slice to the count cap so a client can't pad many bogus refs for runTurn to existsSync-scan.
      const attachments = Array.isArray(p.attachments)
        ? p.attachments.filter((x) => x && typeof x.name === 'string' && isBareBasename(x.name))
            .slice(0, cfg.int('attachmentMaxCount')).map((x) => ({ name: x.name, isImage: !!x.isImage }))
        : [];
      const text = (p.text ?? '').trim();
      // a turn needs text OR at least one attachment (empty-text send is fine with files attached)
      if (!text && !attachments.length) { ack?.({ error: 'empty' }); return; }
      // room team chat: persist + broadcast only, no Claude turn (chat flag valid in rooms only).
      // A slash command is an instruction to the CLI, never a message to teammates — and the room
      // composer opens in team-chat mode, so a command picked from the palette there used to be filed
      // as chat text and never run at all. Route it to Claude whatever the composer says.
      if (p.chat && a.kind === 'room' && !isSlashCommand(text)) {
        postChat(p.sessionId, { id: user.id, name: user.displayName }, text,
          (event, payload) => io.to(sessionRoom(p.sessionId)).emit(event, payload));
        ack?.({ ok: true });
        return;
      }
      // wiki thread: block queries while the topic's knowledge base is (re)compiling
      if (a.s.wikiTopicId) {
        const topic = db.select().from(schema.wikiTopics).where(eq(schema.wikiTopics.id, a.s.wikiTopicId)).get();
        if (topic?.compileStatus === 'compiling') { ack?.({ error: '주제 컴파일 중입니다. 완료 후 질의하세요.' }); return; }
      }
      const itemId = enqueueTurn(p.sessionId, { id: user.id, name: user.displayName }, text,
        undefined, a.kind === 'room' ? p.includeChat : false, attachments);
      ack?.({ itemId });
    });

    socket.on('chat:cancel', (p: { sessionId: string; itemId: string }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      const item = queueState(p.sessionId).waiting.find((w) => w.id === p.itemId);
      const allowed = item?.author.id === user.id
        || (a.kind === 'room' ? rooms.can(a.roomId!, user, 'interrupt') : a.s.ownerId === user.id || user.role === 'admin');
      if (!allowed) { ack?.({ error: 'forbidden' }); return; }
      // Same short-circuit trap as chat:interrupt: cancel must run even when the client sends no ack.
      const ok = cancelQueued(p.sessionId, p.itemId);
      ack?.({ ok });
    });

    // Drop a turn parked for the claude.ai window reset. Same authority as cancelling a queued item:
    // its own author always may; otherwise the session owner / admin / room interrupt-holder.
    socket.on('chat:cancelResume', (p: { sessionId: string; id: string }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      const row = resumesForSession(p.sessionId).find((r) => r.id === p.id);
      if (!row) { ack?.({ ok: false }); return; }
      const allowed = row.author.id === user.id
        || (a.kind === 'room' ? rooms.can(a.roomId!, user, 'interrupt') : a.s.ownerId === user.id || user.role === 'admin');
      if (!allowed) { ack?.({ error: 'forbidden' }); return; }
      const ok = !!cancelResume(p.id); // must run unconditionally — clients may send no ack
      ack?.({ ok });
    });

    socket.on('chat:interrupt', (p: { sessionId: string }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      const allowed = a.kind === 'room' ? rooms.can(a.roomId!, user, 'interrupt')
        : (a.s.ownerId === user.id || user.role === 'admin');
      if (!allowed) { ack?.({ error: 'forbidden' }); return; }
      // interruptTurn MUST run unconditionally — clients emit without an ack callback, so
      // `ack?.({ ok: interruptTurn(...) })` would short-circuit and never call it (stop stayed dead).
      const ok = interruptTurn(p.sessionId);
      ack?.({ ok });
    });

    socket.on('permission:respond', (p: { sessionId: string; requestId: string; decision: Decision; answer?: string }, ack?: Function) => {
      const a = access(user, p.sessionId);
      if (!a) { ack?.({ error: 'no access' }); return; }
      const allowed = a.kind === 'room' ? rooms.can(a.roomId!, user, 'approve')
        : (a.s.ownerId === user.id || user.role === 'admin');
      if (!allowed) { ack?.({ error: 'forbidden' }); return; }
      const ok = respondPermission(p.requestId, p.decision, p.answer);
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
  if (a.kind === 'review') {
    const w = a.canWrite; // admin=true, reader(author)=false
    return { canApprove: w, canInterrupt: w, canSetMode: w, isOwner: w, delegable: [] as string[] };
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
