import { create } from 'zustand';
import { api } from './api';
import { getSocket } from './socket';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean };
export interface Msg { id: string; role: string; authorId?: string | null; authorName?: string | null; content: any; createdAt: number; }
export interface Member { userId: string; displayName: string; avatarColor: string; username: string; isOwner: boolean; delegations: string[]; joinedAt: number; }
export interface RoomSummary { id: string; name: string; ownerId: string; chatSessionId: string; permissionMode: string; members: Member[]; }
export interface PrivateSession { id: string; title: string; updatedAt: number; projectId: string | null; model: string; permissionMode: string; }
export interface Project { id: string; scope: string; ownerId: string | null; name: string; path: string; }
export interface User { id: string; username: string; role: string; displayName: string; avatarColor: string; }
export interface Live { blocks: Block[]; toolMap: Record<string, number>; }
export interface QueueState { running: { id: string; author: { id: string; name: string } } | null; waiting: { id: string; author: { id: string; name: string } }[]; }
export interface Control { canApprove: boolean; canInterrupt: boolean; canSetMode: boolean; isOwner: boolean; delegable: string[]; }
export interface PermReq { requestId: string; tool: string; input: any; }
export interface Current { chatSessionId: string; kind: 'private' | 'room'; roomId?: string; title: string; projectId: string | null; model: string; permissionMode: string; room?: RoomSummary; }

interface State {
  user: User | null;
  theme: 'light' | 'dark' | null;
  sessions: PrivateSession[];
  rooms: RoomSummary[];
  projects: { common: Project[]; mine: Project[] };
  current: Current | null;
  messages: Msg[];
  live: Live | null;
  turnActive: boolean;
  queue: QueueState;
  pending: PermReq[];
  control: Control;
  presence: { id: string; name: string; color: string }[];
  congested: boolean;
  viewMode: 'chat' | 'split' | 'editor';
  editorUrl: string | null;
  panel: null | 'admin' | 'plugins';
  error: string | null;

  bootstrap: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  toggleTheme: () => void;
  refreshLists: () => Promise<void>;
  openPrivate: (id: string) => Promise<void>;
  openRoom: (roomId: string) => Promise<void>;
  newSession: () => Promise<void>;
  newRoom: (name: string) => Promise<void>;
  send: (text: string) => void;
  cancel: (itemId: string) => void;
  interrupt: () => void;
  respond: (requestId: string, decision: 'allow' | 'deny' | 'always') => void;
  setViewMode: (m: 'chat' | 'split' | 'editor') => void;
  openEditor: () => Promise<void>;
  setProject: (projectId: string | null) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  reloadRoom: () => Promise<void>;
  setPanel: (p: null | 'admin' | 'plugins') => void;
  setError: (e: string | null) => void;
}

const emptyLive = (): Live => ({ blocks: [], toolMap: {} });

let wired = false;

export const useStore = create<State>((set, get) => ({
  user: null,
  theme: (localStorage.getItem('theme') as any) || null,
  sessions: [], rooms: [], projects: { common: [], mine: [] },
  current: null, messages: [], live: null, turnActive: false,
  queue: { running: null, waiting: [] }, pending: [],
  control: { canApprove: true, canInterrupt: true, canSetMode: true, isOwner: true, delegable: [] },
  presence: [], congested: false, viewMode: 'chat', editorUrl: null, panel: null, error: null,

  bootstrap: async () => {
    applyTheme(get().theme);
    try {
      const { user } = await api.get('/api/auth/me');
      set({ user });
      wire(set, get);
      await get().refreshLists();
    } catch { set({ user: null }); }
  },

  login: async (u, p) => {
    const { user } = await api.post('/api/auth/login', { username: u, password: p });
    set({ user, error: null });
    wire(set, get);
    await get().refreshLists();
  },

  logout: async () => {
    await api.post('/api/auth/logout');
    set({ user: null, current: null, messages: [], sessions: [], rooms: [] });
  },

  toggleTheme: () => {
    const cur = get().theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    set({ theme: next }); applyTheme(next);
  },

  refreshLists: async () => {
    const [s, r, p] = await Promise.all([api.get('/api/sessions'), api.get('/api/rooms'), api.get('/api/projects')]);
    set({ sessions: s.sessions, rooms: r.rooms, projects: { common: p.common, mine: p.mine } });
  },

  openPrivate: async (id) => {
    const { session, messages } = await api.get(`/api/sessions/${id}`);
    await join(set, get, {
      chatSessionId: session.id, kind: 'private', title: session.title,
      projectId: session.projectId, model: session.model, permissionMode: session.permissionMode,
    }, messages);
  },

  openRoom: async (roomId) => {
    const { room, messages } = await api.get(`/api/rooms/${roomId}`);
    const chat = await api.get(`/api/sessions/${room.chatSessionId}`).catch(() => null);
    await join(set, get, {
      chatSessionId: room.chatSessionId, kind: 'room', roomId: room.id, title: room.name,
      projectId: chat?.session?.projectId ?? null, model: chat?.session?.model || 'claude-opus-4-8',
      permissionMode: room.permissionMode, room,
    }, messages);
  },

  newSession: async () => {
    const { session } = await api.post('/api/sessions', {});
    await get().refreshLists();
    await get().openPrivate(session.id);
  },

  newRoom: async (name) => {
    const { room } = await api.post('/api/rooms', { name });
    await get().refreshLists();
    await get().openRoom(room.id);
  },

  send: (text) => {
    const c = get().current; if (!c) return;
    getSocket().emit('chat:send', { sessionId: c.chatSessionId, text });
  },
  cancel: (itemId) => {
    const c = get().current; if (!c) return;
    getSocket().emit('chat:cancel', { sessionId: c.chatSessionId, itemId });
  },
  interrupt: () => {
    const c = get().current; if (!c) return;
    getSocket().emit('chat:interrupt', { sessionId: c.chatSessionId });
  },
  respond: (requestId, decision) => {
    const c = get().current; if (!c) return;
    getSocket().emit('permission:respond', { sessionId: c.chatSessionId, requestId, decision });
    set({ pending: get().pending.filter((p) => p.requestId !== requestId) });
  },

  setViewMode: (m) => {
    set({ viewMode: m });
    if ((m === 'split' || m === 'editor') && !get().editorUrl) void get().openEditor();
  },

  openEditor: async () => {
    const c = get().current; if (!c?.projectId) { set({ error: '먼저 프로젝트를 선택하세요.' }); return; }
    try {
      const { url } = await api.post(`/api/projects/${c.projectId}/open-editor`);
      set({ editorUrl: url });
    } catch (e: any) { set({ error: e.message, viewMode: 'chat' }); }
  },

  setProject: async (projectId) => {
    const c = get().current; if (!c) return;
    if (c.kind === 'private') await api.patch(`/api/sessions/${c.chatSessionId}`, { projectId });
    else await api.patch(`/api/rooms/${c.roomId}/project`, { projectId });
    set({ current: { ...c, projectId }, editorUrl: null });
  },
  setModel: async (model) => {
    const c = get().current; if (!c) return;
    if (c.kind === 'private') await api.patch(`/api/sessions/${c.chatSessionId}`, { model });
    set({ current: { ...c, model } });
  },
  setMode: async (mode) => {
    const c = get().current; if (!c) return;
    if (c.kind === 'private') await api.patch(`/api/sessions/${c.chatSessionId}`, { permissionMode: mode });
    else await api.post(`/api/rooms/${c.roomId}/mode`, { mode });
    set({ current: { ...c, permissionMode: mode } });
  },

  reloadRoom: async () => {
    const c = get().current; if (c?.kind !== 'room' || !c.roomId) return;
    const { room } = await api.get(`/api/rooms/${c.roomId}`);
    set({ current: { ...c, room }, rooms: get().rooms.map((r) => (r.id === room.id ? room : r)) });
  },

  setPanel: (p) => set({ panel: p }),
  setError: (e) => set({ error: e }),
}));

function applyTheme(theme: 'light' | 'dark' | null) {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

async function join(set: any, get: () => State, cur: Current, messages: Msg[]) {
  const sock = getSocket();
  const prev = get().current;
  if (prev) sock.emit('session:leave', prev.chatSessionId);
  set({
    current: cur, messages, live: null, turnActive: false,
    queue: { running: null, waiting: [] }, pending: [], presence: [],
    viewMode: 'chat', editorUrl: null,
  });
  sock.emit('session:join', cur.chatSessionId, (state: any) => {
    if (state?.error) { set({ error: state.error }); return; }
    set({
      queue: state.queue || { running: null, waiting: [] },
      pending: state.pending || [],
      control: state.control || get().control,
      turnActive: !!state.queue?.running,
    });
  });
}

function wire(set: any, get: () => State) {
  if (wired) return; wired = true;
  const sock = getSocket();
  const isCur = (sessionId: string) => get().current?.chatSessionId === sessionId;

  sock.on('message', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const exists = get().messages.some((m) => m.id === p.message.id);
    if (!exists) set({ messages: [...get().messages, p.message] });
  });

  sock.on('turn:start', (p: any) => { if (isCur(p.sessionId)) set({ live: emptyLive(), turnActive: true, congested: false }); });

  sock.on('assistant:delta', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    const blocks = live.blocks.slice();
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'text') blocks[blocks.length - 1] = { type: 'text', text: last.text + p.text };
    else blocks.push({ type: 'text', text: p.text });
    set({ live: { ...live, blocks } });
  });

  sock.on('tool:use', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    const blocks = live.blocks.slice();
    const idx = blocks.push({ type: 'tool_use', id: p.id, name: p.name, input: p.input }) - 1;
    set({ live: { ...live, blocks, toolMap: { ...live.toolMap, [p.id]: idx } } });
  });

  sock.on('tool:result', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live; if (!live) return;
    const idx = live.toolMap[p.id];
    if (idx == null) return;
    const blocks = live.blocks.slice();
    const b = blocks[idx];
    if (b && b.type === 'tool_use') blocks[idx] = { ...b, output: p.output, isError: p.isError };
    set({ live: { ...live, blocks } });
  });

  sock.on('turn:end', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const exists = get().messages.some((m) => m.id === p.message.id);
    set({
      messages: exists ? get().messages : [...get().messages, p.message],
      live: null, turnActive: false,
    });
  });

  sock.on('turn:error', (p: any) => {
    if (!isCur(p.sessionId)) return;
    set({ live: null, turnActive: false, error: p.aborted ? null : `오류: ${p.error}` });
  });

  sock.on('permission:request', (p: any) => {
    if (!isCur(p.sessionId)) return;
    set({ pending: [...get().pending.filter((x) => x.requestId !== p.requestId), { requestId: p.requestId, tool: p.tool, input: p.input }] });
  });
  const clearPerm = (p: any) => { if (isCur(p.sessionId)) set({ pending: get().pending.filter((x) => x.requestId !== p.requestId) }); };
  sock.on('permission:resolved', clearPerm);
  sock.on('permission:answered', clearPerm);

  sock.on('queue:update', (p: any) => { if (isCur(p.sessionId)) set({ queue: { running: p.running, waiting: p.waiting } }); });
  sock.on('presence:update', (p: any) => { if (isCur(p.sessionId)) set({ presence: p.users }); });
  sock.on('turn:congested', (p: any) => { if (isCur(p.sessionId)) { set({ congested: true }); setTimeout(() => set({ congested: false }), 4000); } });
}
