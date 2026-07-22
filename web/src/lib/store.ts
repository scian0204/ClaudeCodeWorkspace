import { create } from 'zustand';
import { api } from './api';
import { getSocket } from './socket';
import { t } from './i18n';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean };
export interface Msg { id: string; role: string; authorId?: string | null; authorName?: string | null; content: any; createdAt: number; }
export interface CmdInfo { name: string; description: string; argumentHint: string }
export interface Member { userId: string; displayName: string; avatarColor: string; username: string; isOwner: boolean; delegations: string[]; joinedAt: number; }
export interface RoomSummary { id: string; name: string; ownerId: string; chatSessionId: string; permissionMode: string; members: Member[]; }
export interface PrivateSession { id: string; title: string; updatedAt: number; projectId: string | null; model: string; permissionMode: string; }
export interface Project { id: string; scope: string; ownerId: string | null; name: string; path: string; }
export interface WikiTopic { id: string; name: string; description: string; path: string; createdBy: string; createdAt: number; compileStatus?: string; compiledAt?: number | null; compileError?: string | null; }
export interface User { id: string; username: string; role: string; displayName: string; avatarColor: string; hasClaudeToken?: boolean; claudeTokenSetAt?: number | null; }
export interface Live { blocks: Block[]; toolMap: Record<string, number>; }
export interface QueueState { running: { id: string; author: { id: string; name: string } } | null; waiting: { id: string; author: { id: string; name: string } }[]; }
export interface Control { canApprove: boolean; canInterrupt: boolean; canSetMode: boolean; isOwner: boolean; delegable: string[]; }
export interface PermReq { requestId: string; tool: string; input: any; }
export interface Current { chatSessionId: string; kind: 'private' | 'room'; roomId?: string; wikiTopicId?: string; title: string; projectId: string | null; model: string; permissionMode: string; room?: RoomSummary; }

interface State {
  user: User | null;
  theme: 'light' | 'dark' | null;
  sessions: PrivateSession[];
  rooms: RoomSummary[];
  wikiTopics: WikiTopic[];
  wikiProgress: Record<string, string>; // topicId -> latest compile step (transient)
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
  commands: CmdInfo[];

  bootstrap: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  toggleTheme: () => void;
  refreshLists: () => Promise<void>;
  openPrivate: (id: string) => Promise<void>;
  openRoom: (roomId: string) => Promise<void>;
  openWiki: (topicId: string) => Promise<void>;
  newSession: () => Promise<void>;
  newRoom: (name: string) => Promise<void>;
  newWikiTopic: (payload: { name: string; description: string; stagingId?: string; precompiled?: boolean }) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  deleteRoom: (id: string) => Promise<void>;
  deleteWikiTopic: (id: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, text: string) => Promise<void>;
  send: (text: string) => void;
  cancel: (itemId: string) => void;
  interrupt: () => void;
  respond: (requestId: string, decision: 'allow' | 'deny' | 'always' | 'answer', answer?: string) => void;
  setViewMode: (m: 'chat' | 'split' | 'editor') => void;
  openEditor: () => Promise<void>;
  setProject: (projectId: string | null) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  reloadRoom: () => Promise<void>;
  setPanel: (p: null | 'admin' | 'plugins') => void;
  setError: (e: string | null) => void;
  saveClaudeToken: (token: string) => Promise<void>;
  clearClaudeToken: () => Promise<void>;
}

const emptyLive = (): Live => ({ blocks: [], toolMap: {} });

let wired = false;

export const useStore = create<State>((set, get) => ({
  user: null,
  theme: (localStorage.getItem('theme') as any) || null,
  sessions: [], rooms: [], wikiTopics: [], wikiProgress: {}, projects: { common: [], mine: [] },
  current: null, messages: [], live: null, turnActive: false,
  queue: { running: null, waiting: [] }, pending: [],
  control: { canApprove: true, canInterrupt: true, canSetMode: true, isOwner: true, delegable: [] },
  presence: [], congested: false, viewMode: 'chat', editorUrl: null, panel: null, error: null,
  commands: [],

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
    set({ user: null, current: null, messages: [], sessions: [], rooms: [], wikiTopics: [] });
  },

  toggleTheme: () => {
    const cur = get().theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    set({ theme: next }); applyTheme(next);
  },

  refreshLists: async () => {
    const [s, r, p, w] = await Promise.all([
      api.get('/api/sessions'), api.get('/api/rooms'), api.get('/api/projects'), api.get('/api/wiki/topics'),
    ]);
    set({ sessions: s.sessions, rooms: r.rooms, projects: { common: p.common, mine: p.mine }, wikiTopics: w.topics });
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

  openWiki: async (topicId) => {
    const t = get().wikiTopics.find((x) => x.id === topicId);
    const { session, messages } = await api.get(`/api/wiki/topics/${topicId}/thread`);
    await join(set, get, {
      chatSessionId: session.id, kind: 'private', wikiTopicId: topicId,
      title: session.title || t?.name || 'Wiki',
      projectId: null, model: session.model || 'claude-opus-4-8', permissionMode: session.permissionMode || 'default',
    }, messages);
  },

  newSession: async () => {
    const { session } = await api.post('/api/sessions', {});
    await get().refreshLists();
    await get().openPrivate(session.id);
  },

  newWikiTopic: async (payload) => {
    const { topic } = await api.post('/api/wiki/topics', payload);
    await get().refreshLists();
    await get().openWiki(topic.id);
  },

  newRoom: async (name) => {
    const { room } = await api.post('/api/rooms', { name });
    await get().refreshLists();
    await get().openRoom(room.id);
  },

  deleteSession: async (id) => {
    await api.del(`/api/sessions/${id}`);
    if (get().current?.chatSessionId === id) set({ current: null, messages: [] });
    await get().refreshLists();
  },
  deleteRoom: async (id) => {
    await api.del(`/api/rooms/${id}`);
    if (get().current?.roomId === id) set({ current: null, messages: [] });
    await get().refreshLists();
  },
  deleteWikiTopic: async (id) => {
    await api.del(`/api/wiki/topics/${id}`);
    if (get().current?.wikiTopicId === id) set({ current: null, messages: [] });
    await get().refreshLists();
  },
  deleteMessage: async (mid) => {
    const c = get().current; if (!c) return;
    await api.del(`/api/sessions/${c.chatSessionId}/messages/${mid}`);
    set({ messages: get().messages.filter((m) => m.id !== mid) });
  },
  editMessage: async (mid, text) => {
    const c = get().current; if (!c) return;
    const { messages } = await api.post(`/api/sessions/${c.chatSessionId}/messages/${mid}/edit`, {});
    set({ messages });
    getSocket().emit('chat:send', { sessionId: c.chatSessionId, text });
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
  respond: (requestId, decision, answer) => {
    const c = get().current; if (!c) return;
    getSocket().emit('permission:respond', { sessionId: c.chatSessionId, requestId, decision, answer });
    set({ pending: get().pending.filter((p) => p.requestId !== requestId) });
  },

  setViewMode: (m) => {
    set({ viewMode: m });
    if ((m === 'split' || m === 'editor') && !get().editorUrl) void get().openEditor();
  },

  openEditor: async () => {
    const c = get().current; if (!c?.projectId) { set({ error: t('store.selectProjectFirst') }); return; }
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

  saveClaudeToken: async (token) => {
    const { user } = await api.put('/api/auth/me/claude-token', { token });
    set({ user });
  },
  clearClaudeToken: async () => {
    const { user } = await api.del('/api/auth/me/claude-token');
    set({ user });
  },
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
    viewMode: 'chat', editorUrl: null, commands: [],
  });
  // fetch the real slash commands (built-in + plugin + skill) the CLI exposes (non-blocking)
  api.get(`/api/sessions/${cur.chatSessionId}/commands`)
    .then((r) => { if (get().current?.chatSessionId === cur.chatSessionId) set({ commands: r.commands || [] }); })
    .catch(() => {});
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
    set({ live: null, turnActive: false, error: p.aborted ? null : t('common.errorPrefix', { msg: p.error }) });
  });

  sock.on('permission:request', (p: any) => {
    if (!isCur(p.sessionId)) return;
    set({ pending: [...get().pending.filter((x) => x.requestId !== p.requestId), { requestId: p.requestId, tool: p.tool, input: p.input }] });
  });
  const clearPerm = (p: any) => { if (isCur(p.sessionId)) set({ pending: get().pending.filter((x) => x.requestId !== p.requestId) }); };
  sock.on('permission:resolved', clearPerm);
  sock.on('permission:answered', clearPerm);

  // wiki compile status (broadcast to all sockets) — keep the topic list's badges live
  sock.on('wiki:status', (p: any) => {
    const wp = { ...get().wikiProgress };
    if (p.status !== 'compiling') delete wp[p.topicId]; // clear step once settled
    set({
      wikiProgress: wp,
      wikiTopics: get().wikiTopics.map((t) => (t.id === p.topicId
        ? { ...t, compileStatus: p.status, compiledAt: p.compiledAt ?? t.compiledAt, compileError: p.error ?? null } : t)),
    });
  });
  // live compile heartbeat — latest step per topic (proves it's progressing, not hung)
  sock.on('wiki:progress', (p: any) => {
    set({ wikiProgress: { ...get().wikiProgress, [p.topicId]: p.step } });
  });

  sock.on('queue:update', (p: any) => { if (isCur(p.sessionId)) set({ queue: { running: p.running, waiting: p.waiting } }); });
  sock.on('presence:update', (p: any) => { if (isCur(p.sessionId)) set({ presence: p.users }); });
  sock.on('turn:congested', (p: any) => { if (isCur(p.sessionId)) { set({ congested: true }); setTimeout(() => set({ congested: false }), 4000); } });
}
