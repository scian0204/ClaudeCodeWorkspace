import { create } from 'zustand';
import { api } from './api';
import { getSocket } from './socket';
import { t } from './i18n';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean };
export interface Attachment { name: string; isImage: boolean; url?: string } // url: local preview / demo data URL (real mode falls back to the GET endpoint)
export interface Msg { id: string; role: string; authorId?: string | null; authorName?: string | null; content: any; chat?: boolean; createdAt: number; }
export interface CmdInfo { name: string; description: string; argumentHint: string }
export interface Member { userId: string; displayName: string; avatarColor: string; username: string; isOwner: boolean; delegations: string[]; joinedAt: number; }
export interface RoomSummary { id: string; name: string; ownerId: string; chatSessionId: string; permissionMode: string; members: Member[]; }
export interface PrivateSession { id: string; title: string; updatedAt: number; projectId: string | null; model: string; effort: string; permissionMode: string; }
export interface Project { id: string; scope: string; ownerId: string | null; name: string; path: string; }
export interface WikiTopic { id: string; name: string; description: string; path: string; createdBy: string; createdAt: number; compileStatus?: string; compiledAt?: number | null; compileError?: string | null; }
export interface ReviewRepo { id: string; name: string; provider: string; host: string; slug: string; gitUrl: string; baseBranch: string | null; sandboxImage: string | null; polledAt: number | null; pollError: string | null; openCount: number; createdAt: number; }
export interface ReviewSessionSummary { id: string; chatSessionId: string; repoId: string; repoName: string; prNumber: number; prTitle: string; prUrl: string; prState: string; authorLogin: string; mergeState: string; verdict: string; verdictSummary: string | null; readOnly: boolean; updatedAt: number; }
export interface ReviewMeta { reviewId: string; prNumber: number; prTitle: string; prUrl: string; prState: string; authorLogin: string; baseRef: string; headRef: string; mergeState: string; verdict: string; verdictSummary: string | null; repoName: string; provider: string; }
export interface User { id: string; username: string; role: string; displayName: string; avatarColor: string; avatar?: string | null; hasClaudeToken?: boolean; claudeTokenSetAt?: number | null; autoTitle?: boolean; autoResume?: boolean; primeWindow?: boolean; primedAt?: number | null; }
export interface DmMemberInfo { userId: string; displayName: string; avatarColor: string; avatar: string | null; username: string; }
export interface DmChannel { id: string; kind: 'dm' | 'group'; name: string | null; createdBy: string; createdAt: number; members: DmMemberInfo[]; lastMessage: { text: string; createdAt: number; userId: string } | null; unread: number; }
export interface DmMessage { id: string; channelId: string; userId: string; text: string; createdAt: number; }
export interface AdminRequest { id: string; requesterId: string; type: string; payload: string; reason: string; status: 'pending' | 'approved' | 'rejected'; reviewerId: string | null; decidedAt: number | null; result: string | null; createdAt: number; updatedAt: number; }
export interface RequestAction { type: string; label: string; fields: { key: string; type: 'text' | 'textarea'; required: boolean }[]; }
// Unified search (GET /api/search) — mirrors server/src/routes/search.ts Hit/HitNav.
export type HitType = 'chat' | 'session' | 'room' | 'dm' | 'channel' | 'project' | 'wiki' | 'wikiFile' | 'review' | 'user';
export interface HitNav {
  kind: 'private' | 'room' | 'wiki' | 'review' | 'channel' | 'project' | 'wikiFile' | 'user';
  sessionId?: string; roomId?: string; topicId?: string; reviewId?: string;
  channelId?: string; projectId?: string; userId?: string;
  messageId?: string; dir?: 'raw' | 'wiki'; filePath?: string;
}
export interface SearchHit { type: HitType; id: string; title: string; subtitle?: string; snippet?: string; ts?: number; nav: HitNav; }
export interface Live { blocks: Block[]; toolMap: Record<string, number>; }
export interface QueueState { running: { id: string; author: { id: string; name: string } } | null; waiting: { id: string; author: { id: string; name: string } }[]; }
// A turn parked until the author's claude.ai plan window (5h / weekly) resets — see server/src/claude/auto-resume.ts.
export interface PendingResume { id: string; sessionId: string; author: { id: string; name: string }; text: string; attempts: number; resumeAt: number; }
export interface Control { canApprove: boolean; canInterrupt: boolean; canSetMode: boolean; isOwner: boolean; delegable: string[]; }
export interface PermReq { requestId: string; tool: string; input: any; }
export interface Current { chatSessionId: string; kind: 'private' | 'room' | 'review'; roomId?: string; wikiTopicId?: string; reviewId?: string; review?: ReviewMeta; readOnly?: boolean; title: string; projectId: string | null; model: string; effort: string; permissionMode: string; room?: RoomSummary; }

interface State {
  user: User | null;
  theme: 'light' | 'dark' | null;
  sessions: PrivateSession[];
  rooms: RoomSummary[];
  wikiTopics: WikiTopic[];
  reviewRepos: ReviewRepo[];
  reviewSessions: ReviewSessionSummary[];
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
  sessionImportEnabled: boolean; // admin feature flag (from /api/config)
  llmProvidersEnabled: boolean;  // admin feature flag (from /api/config) — gates the LLM provider UI
  approvalsEnabled: boolean;     // admin feature flag (from /api/config) — gates the member-request UI
  dmEnabled: boolean;            // admin feature flag (from /api/config) — gates the DM/group chat UI
  searchEnabled: boolean;        // admin feature flag (from /api/config) — gates the unified-search UI
  customContextMenuEnabled: boolean; // admin feature flag (from /api/config) — off = browser's own right-click menu everywhere
  autoTitleEnabled: boolean;     // admin feature flag (from /api/config) — gates the auto session-title toggle
  autoResumeEnabled: boolean;    // admin feature flag (from /api/config) — gates the 5h-reset auto-resume toggle
  resumes: PendingResume[];      // open session's turns parked for a claude.ai window reset
  windowPrimerEnabled: boolean;  // admin feature flag (from /api/config) — gates the 5h-window primer toggle
  searchOpen: boolean;           // unified-search palette (Ctrl/Cmd+K)
  shortcutsOpen: boolean;        // keyboard-shortcut cheat sheet (?)
  highlightMsgId: string | null; // message a search hit jumped to (scroll target + ring)
  processPollMs: number;         // admin process panel auto-poll interval (from /api/config)
  channels: DmChannel[];         // DM + group chat channels the user belongs to
  activeChannelId: string | null; // open DM/group channel (main panel shows DmView when set)
  channelMessages: DmMessage[];  // messages of the open channel
  requests: AdminRequest[];      // member: own requests; admin: all
  pendingRequestCount: number;   // admins only — drives the sidebar admin-panel badge
  viewMode: 'chat' | 'split' | 'editor';
  editorUrl: string | null;
  panel: null | 'admin' | 'plugins' | 'me';
  sidebarOpen: boolean; // mobile off-canvas drawer (ignored ≥md, sidebar is a static column there)
  sidebarCollapsed: boolean; // ≥md only: hide the sidebar column (persisted; <md the drawer rules instead)
  error: string | null;
  commands: CmdInfo[];

  bootstrap: () => Promise<void>;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  toggleTheme: () => void;
  refreshLists: () => Promise<void>;
  refreshRequests: () => Promise<void>;
  submitRequest: (type: string, payload: Record<string, string>, reason: string) => Promise<void>;
  decideRequest: (id: string, approve: boolean, note?: string) => Promise<void>;
  openPrivate: (id: string) => Promise<void>;
  openRoom: (roomId: string) => Promise<void>;
  openWiki: (topicId: string) => Promise<void>;
  openReview: (reviewId: string) => Promise<void>;
  openChannel: (id: string) => Promise<void>;
  goHome: () => void;
  setSearchOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setHighlightMsgId: (id: string | null) => void;
  openHit: (hit: SearchHit) => Promise<void>;
  sendDm: (text: string) => void;
  createDm: (userId: string) => Promise<void>;
  createGroup: (name: string, memberIds: string[]) => Promise<void>;
  promoteChannel: (id: string) => Promise<void>;
  markReadDm: (id: string) => void;
  newReviewRepo: (payload: { name?: string; gitUrl: string; credentialId: string; provider?: string; baseBranch?: string; sandboxImage?: string }) => Promise<void>;
  updateReviewRepo: (id: string, payload: { name?: string; baseBranch?: string; sandboxImage?: string; credentialId?: string }) => Promise<void>;
  deleteReviewRepo: (id: string) => Promise<void>;
  pollReviewRepo: (id: string) => Promise<void>;
  mergeReview: (reviewId: string) => Promise<{ mergeState: string; output: string }>;
  autoReviewRun: (reviewId: string) => Promise<void>;
  approveReview: (reviewId: string) => Promise<{ output: string }>;
  newSession: () => Promise<void>;
  importSessions: (payload: { sid: string; projectName?: string; sessionUuids: string[]; autoTitle: boolean; overwrite: string[]; projectOverwrite: boolean }) => Promise<{ project: any; sessions: any[] }>;
  newRoom: (name: string) => Promise<void>;
  newWikiTopic: (payload: { name: string; description: string; stagingId?: string; precompiled?: boolean }) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteRoom: (id: string) => Promise<void>;
  deleteWikiTopic: (id: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, text: string) => Promise<void>;
  send: (text: string, opts?: { chat?: boolean; includeChat?: boolean; attachments?: Attachment[] }) => void;
  cancel: (itemId: string) => void;
  interrupt: () => void;
  respond: (requestId: string, decision: 'allow' | 'deny' | 'always' | 'answer', answer?: string) => void;
  setViewMode: (m: 'chat' | 'split' | 'editor') => void;
  openEditor: () => Promise<void>;
  setProject: (projectId: string | null) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setEffort: (effort: string) => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  reloadRoom: () => Promise<void>;
  setPanel: (p: null | 'admin' | 'plugins' | 'me') => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setError: (e: string | null) => void;
  setAutoTitle: (on: boolean) => Promise<void>;
  setAutoResume: (on: boolean) => Promise<void>;
  setPrimeWindow: (on: boolean) => Promise<void>;
  cancelResume: (id: string) => void;
  saveClaudeToken: (token: string) => Promise<void>;
  clearClaudeToken: () => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  clearAvatar: () => Promise<void>;
}

const emptyLive = (): Live => ({ blocks: [], toolMap: {} });

let wired = false;

export const useStore = create<State>((set, get) => ({
  user: null,
  theme: (localStorage.getItem('theme') as any) || null,
  sessions: [], rooms: [], wikiTopics: [], reviewRepos: [], reviewSessions: [], wikiProgress: {}, projects: { common: [], mine: [] },
  current: null, messages: [], live: null, turnActive: false,
  queue: { running: null, waiting: [] }, pending: [],
  control: { canApprove: true, canInterrupt: true, canSetMode: true, isOwner: true, delegable: [] },
  presence: [], congested: false, sessionImportEnabled: true, llmProvidersEnabled: true, approvalsEnabled: true, dmEnabled: true, searchEnabled: true, customContextMenuEnabled: true, autoTitleEnabled: true, autoResumeEnabled: true, windowPrimerEnabled: true, resumes: [], searchOpen: false, shortcutsOpen: false, highlightMsgId: null, processPollMs: 5000, requests: [], pendingRequestCount: 0, viewMode: 'chat', editorUrl: null, panel: null, sidebarOpen: false, sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === '1', error: null,
  channels: [], activeChannelId: null, channelMessages: [],
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
    set({ user: null, current: null, messages: [], sessions: [], rooms: [], wikiTopics: [], reviewRepos: [], reviewSessions: [], requests: [], pendingRequestCount: 0, channels: [], activeChannelId: null, channelMessages: [], searchOpen: false, shortcutsOpen: false, highlightMsgId: null });
  },

  toggleTheme: () => {
    const cur = get().theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    set({ theme: next }); applyTheme(next);
  },

  refreshLists: async () => {
    const isAdmin = get().user?.role === 'admin';
    const [s, r, p, w, rv, rr, cf, dmc] = await Promise.all([
      api.get('/api/sessions'), api.get('/api/rooms'), api.get('/api/projects'), api.get('/api/wiki/topics'),
      api.get('/api/review/sessions'),
      isAdmin ? api.get('/api/review/repos') : Promise.resolve({ repos: [] }),
      api.get('/api/config').catch(() => ({})),
      api.get('/api/dm/channels').catch(() => ({ channels: [] })), // 404 when dmEnabled=false
    ]);
    set({
      sessions: s.sessions, rooms: r.rooms, projects: { common: p.common, mine: p.mine }, wikiTopics: w.topics,
      reviewSessions: rv.sessions || [], reviewRepos: rr.repos || [],
      sessionImportEnabled: cf.sessionImportEnabled !== false,
      llmProvidersEnabled: cf.llmProvidersEnabled !== false,
      approvalsEnabled: cf.approvalsEnabled !== false,
      dmEnabled: cf.dmEnabled !== false,
      searchEnabled: cf.searchEnabled !== false,
      customContextMenuEnabled: cf.customContextMenu !== false,
      autoTitleEnabled: cf.autoTitleEnabled !== false,
      autoResumeEnabled: cf.autoResumeEnabled !== false,
      windowPrimerEnabled: cf.windowPrimerEnabled !== false,
      channels: dmc.channels || [],
      processPollMs: cf.processPollMs || 5000,
    });
    await get().refreshRequests();
  },

  refreshRequests: async () => {
    const u = get().user; if (!u) return;
    if (!get().approvalsEnabled) { set({ requests: [], pendingRequestCount: 0 }); return; }
    try {
      const { requests } = await api.get('/api/requests');
      const list: AdminRequest[] = requests || [];
      set({ requests: list, pendingRequestCount: u.role === 'admin' ? list.filter((x) => x.status === 'pending').length : 0 });
    } catch { set({ requests: [], pendingRequestCount: 0 }); }
  },
  submitRequest: async (type, payload, reason) => {
    await api.post('/api/requests', { type, payload, reason });
    await get().refreshRequests();
  },
  decideRequest: async (id, approve, note) => {
    await api.post(`/api/requests/${id}/decide`, { approve, note });
    await get().refreshRequests();
  },

  openPrivate: async (id) => {
    const { session, messages } = await api.get(`/api/sessions/${id}`);
    await join(set, get, {
      chatSessionId: session.id, kind: 'private', title: session.title,
      projectId: session.projectId, model: session.model, effort: session.effort || 'high', permissionMode: session.permissionMode,
    }, messages);
  },

  openRoom: async (roomId) => {
    const { room, messages } = await api.get(`/api/rooms/${roomId}`);
    const chat = await api.get(`/api/sessions/${room.chatSessionId}`).catch(() => null);
    await join(set, get, {
      chatSessionId: room.chatSessionId, kind: 'room', roomId: room.id, title: room.name,
      projectId: chat?.session?.projectId ?? null, model: chat?.session?.model || 'claude-opus-4-8',
      effort: chat?.session?.effort || 'high', permissionMode: room.permissionMode, room,
    }, messages);
  },

  openWiki: async (topicId) => {
    const t = get().wikiTopics.find((x) => x.id === topicId);
    const { session, messages } = await api.get(`/api/wiki/topics/${topicId}/thread`);
    await join(set, get, {
      chatSessionId: session.id, kind: 'private', wikiTopicId: topicId,
      title: session.title || t?.name || 'Wiki',
      projectId: null, model: session.model || 'claude-opus-4-8', effort: session.effort || 'high', permissionMode: session.permissionMode || 'default',
    }, messages);
  },

  openReview: async (reviewId) => {
    const { review, repo, role } = await api.get(`/api/review/sessions/${reviewId}`);
    const { session, messages } = await api.get(`/api/sessions/${review.chatSessionId}`);
    await join(set, get, {
      chatSessionId: review.chatSessionId, kind: 'review', reviewId,
      title: session.title || `#${review.prNumber}`, projectId: null,
      model: session.model || 'claude-opus-4-8', effort: session.effort || 'high', permissionMode: session.permissionMode || 'default',
      readOnly: role !== 'admin',
      review: {
        reviewId, prNumber: review.prNumber, prTitle: review.prTitle, prUrl: review.prUrl,
        prState: review.prState, authorLogin: review.authorLogin, baseRef: review.baseRef,
        headRef: review.headRef, mergeState: review.mergeState,
        verdict: review.verdict, verdictSummary: review.verdictSummary,
        repoName: repo?.name || '', provider: repo?.provider || '',
      },
    }, messages);
  },
  newReviewRepo: async (payload) => {
    await api.post('/api/review/repos', payload);
    await get().refreshLists();
  },
  updateReviewRepo: async (id, payload) => {
    await api.patch(`/api/review/repos/${id}`, payload);
    await get().refreshLists();
  },
  deleteReviewRepo: async (id) => {
    await api.del(`/api/review/repos/${id}`);
    await get().refreshLists();
    const c = get().current;
    if (c?.kind === 'review' && !get().reviewSessions.some((s) => s.id === c.reviewId)) set({ current: null, messages: [] });
  },
  pollReviewRepo: async (id) => {
    await api.post(`/api/review/repos/${id}/poll`);
    await get().refreshLists();
  },
  mergeReview: async (reviewId) => {
    const r = await api.post(`/api/review/sessions/${reviewId}/merge`);
    const c = get().current;
    if (c?.kind === 'review' && c.reviewId === reviewId && c.review) set({ current: { ...c, review: { ...c.review, mergeState: r.mergeState } } });
    await get().refreshLists();
    return { mergeState: r.mergeState, output: r.output };
  },
  autoReviewRun: async (reviewId) => {
    await api.post(`/api/review/sessions/${reviewId}/auto`); // fire-and-forget; verdict streams in via review:changed
    const c = get().current;
    if (c?.kind === 'review' && c.reviewId === reviewId && c.review) set({ current: { ...c, review: { ...c.review, verdict: 'running' } } });
    await get().refreshLists();
  },
  approveReview: async (reviewId) => {
    const r = await api.post(`/api/review/sessions/${reviewId}/approve`);
    await get().refreshLists();
    return { output: r.output };
  },

  // ── DM / group chat ── (a channel is NOT a Claude chat session; it uses its own view + state)
  openChannel: async (id) => {
    const prev = get().current;
    if (prev) getSocket().emit('session:leave', prev.chatSessionId); // release any open Claude session room
    set({ panel: null, activeChannelId: id, current: null, messages: [], channelMessages: [], sidebarOpen: false });
    try {
      const { messages } = await api.get(`/api/dm/channels/${id}/messages`);
      if (get().activeChannelId === id) set({ channelMessages: messages || [] });
    } catch { /* membership/enabled errors surface as an empty view */ }
    get().markReadDm(id);
  },
  sendDm: (text) => {
    const id = get().activeChannelId; if (!id || !text.trim()) return;
    getSocket().emit('dm:send', { channelId: id, text: text.trim() });
  },
  createDm: async (userId) => {
    const { channel } = await api.post('/api/dm/channels', { kind: 'dm', userId });
    await get().refreshLists();
    await get().openChannel(channel.id);
  },
  createGroup: async (name, memberIds) => {
    const { channel } = await api.post('/api/dm/channels', { kind: 'group', name, memberIds });
    await get().refreshLists();
    await get().openChannel(channel.id);
  },
  promoteChannel: async (id) => {
    const { roomId } = await api.post(`/api/dm/channels/${id}/promote`);
    set({ activeChannelId: null });
    await get().refreshLists();
    await get().openRoom(roomId);
  },
  markReadDm: (id) => {
    getSocket().emit('dm:read', { channelId: id });
    set({ channels: get().channels.map((c) => (c.id === id ? { ...c, unread: 0 } : c)) }); // optimistic
  },

  // Back to the landing screen (the logo click): drop whatever is open — Claude thread, DM channel
  // or panel — and release the socket room so we stop receiving that session's events.
  goHome: () => {
    const prev = get().current;
    if (prev) getSocket().emit('session:leave', prev.chatSessionId);
    set({
      current: null, messages: [], live: null, turnActive: false,
      queue: { running: null, waiting: [] }, pending: [], presence: [], commands: [],
      activeChannelId: null, channelMessages: [], highlightMsgId: null,
      panel: null, viewMode: 'chat', editorUrl: null, sidebarOpen: false,
    });
  },

  // ── unified search ──
  setSearchOpen: (open) => set({ searchOpen: open, sidebarOpen: false }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open, sidebarOpen: false }),
  setHighlightMsgId: (id) => set({ highlightMsgId: id }),
  // Navigate to a search hit. Reuses the existing openers so a hit lands exactly where the sidebar
  // would put you; 'project' / 'wikiFile' are explorer targets handled by SearchPalette itself.
  openHit: async (hit) => {
    const n = hit.nav;
    set({ searchOpen: false, panel: null, highlightMsgId: null });
    switch (n.kind) {
      case 'private': if (n.sessionId) await get().openPrivate(n.sessionId); break;
      case 'room': if (n.roomId) await get().openRoom(n.roomId); break;
      case 'wiki': if (n.topicId) await get().openWiki(n.topicId); break;
      case 'review': if (n.reviewId) await get().openReview(n.reviewId); break;
      case 'channel': if (n.channelId) await get().openChannel(n.channelId); break;
      case 'user': if (n.userId && get().dmEnabled) await get().createDm(n.userId); break; // find-or-create the 1:1
      default: return; // project / wikiFile: the palette opens a file explorer instead
    }
    // set AFTER the open — join() clears it so a plain session switch never keeps a stale ring
    if (n.messageId) set({ highlightMsgId: n.messageId });
  },

  newSession: async () => {
    const { session } = await api.post('/api/sessions', {});
    await get().refreshLists();
    await get().openPrivate(session.id);
  },

  importSessions: async (payload) => {
    const r = await api.post('/api/import/sessions', payload);
    await get().refreshLists();
    return r;
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
  renameSession: async (id, title) => {
    await api.patch(`/api/sessions/${id}`, { title });
    set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, title } : s)) });
    const c = get().current;
    if (c && c.chatSessionId === id) set({ current: { ...c, title } });
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

  send: (text, opts) => {
    const c = get().current; if (!c) return;
    getSocket().emit('chat:send', { sessionId: c.chatSessionId, text, chat: opts?.chat, includeChat: opts?.includeChat, attachments: opts?.attachments });
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
  deleteProject: async (projectId) => {
    await api.del(`/api/projects/${projectId}`);
    const c = get().current;
    if (c && c.projectId === projectId) set({ current: { ...c, projectId: null }, editorUrl: null });
    await get().refreshLists();
  },
  createProject: async (name) => {
    await api.post('/api/projects', { name }); // scope defaults to 'user' (owned by requester)
    await get().refreshLists();
  },
  setModel: async (model) => {
    const c = get().current; if (!c) return;
    if (c.kind === 'private' || c.kind === 'review') await api.patch(`/api/sessions/${c.chatSessionId}`, { model });
    set({ current: { ...c, model } });
  },
  setEffort: async (effort) => {
    const c = get().current; if (!c) return;
    if (c.kind === 'private' || c.kind === 'review') await api.patch(`/api/sessions/${c.chatSessionId}`, { effort });
    set({ current: { ...c, effort } });
  },
  setMode: async (mode) => {
    const c = get().current; if (!c) return;
    if (c.kind === 'room') await api.post(`/api/rooms/${c.roomId}/mode`, { mode });
    else await api.patch(`/api/sessions/${c.chatSessionId}`, { permissionMode: mode });
    set({ current: { ...c, permissionMode: mode } });
  },

  reloadRoom: async () => {
    const c = get().current; if (c?.kind !== 'room' || !c.roomId) return;
    const { room } = await api.get(`/api/rooms/${c.roomId}`);
    set({ current: { ...c, room }, rooms: get().rooms.map((r) => (r.id === room.id ? room : r)) });
  },

  setPanel: (p) => set({ panel: p, sidebarOpen: false }), // navigating a panel closes the mobile drawer
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarCollapsed: (collapsed) => { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); set({ sidebarCollapsed: collapsed }); },
  setError: (e) => set({ error: e }),

  setAutoTitle: async (on) => {
    const { user } = await api.patch('/api/auth/me', { autoTitle: on });
    set({ user });
  },

  setAutoResume: async (on) => {
    const { user } = await api.patch('/api/auth/me', { autoResume: on });
    set({ user });
  },

  setPrimeWindow: async (on) => {
    const { user } = await api.patch('/api/auth/me', { primeWindow: on });
    set({ user });
  },
  // Drop a parked turn. Optimistic: the server's turn:resumeCancelled confirms for every other tab.
  cancelResume: (id) => {
    const c = get().current; if (!c) return;
    getSocket().emit('chat:cancelResume', { sessionId: c.chatSessionId, id });
    set({ resumes: get().resumes.filter((r) => r.id !== id) });
  },

  saveClaudeToken: async (token) => {
    const { user } = await api.put('/api/auth/me/claude-token', { token });
    set({ user });
  },
  clearClaudeToken: async () => {
    const { user } = await api.del('/api/auth/me/claude-token');
    set({ user });
  },

  uploadAvatar: async (file) => {
    const form = new FormData();
    form.append('avatar', file, file.name);
    const { user } = await api.upload('/api/auth/me/avatar', form);
    set({ user });
  },
  clearAvatar: async () => {
    const { user } = await api.del('/api/auth/me/avatar');
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
    viewMode: 'chat', editorUrl: null, commands: [], sidebarOpen: false, // opening a thread closes the mobile drawer
    highlightMsgId: null, // a plain thread switch drops any search-hit highlight
    activeChannelId: null, channelMessages: [], // opening a Claude thread hides any open DM view
  });
  // fetch the real slash commands (built-in + plugin + skill) the CLI exposes (non-blocking)
  api.get(`/api/sessions/${cur.chatSessionId}/commands`)
    .then((r) => { if (get().current?.chatSessionId === cur.chatSessionId) set({ commands: r.commands || [] }); })
    .catch(() => {});
  sock.emit('session:join', cur.chatSessionId, (state: any) => applyJoinState(set, get, cur.chatSessionId, state));
}

// Apply a session:join ack: queue/pending/control + replay any in-flight turn (blocks that streamed
// before this client joined). Shared by initial open and socket reconnect so a turn running while
// we weren't subscribed still renders.
function applyJoinState(set: any, get: () => State, sessionId: string, state: any) {
  if (!state) return;
  if (state.error) { set({ error: state.error }); return; }
  if (get().current?.chatSessionId !== sessionId) return;
  let live: Live | null = null;
  const lb = state.live?.blocks;
  if (Array.isArray(lb) && lb.length) {
    const toolMap: Record<string, number> = {};
    lb.forEach((b: any, i: number) => { if (b?.type === 'tool_use') toolMap[b.id] = i; });
    live = { blocks: lb, toolMap };
  }
  set({
    queue: state.queue || { running: null, waiting: [] },
    pending: state.pending || [],
    control: state.control || get().control,
    turnActive: !!state.queue?.running || !!live,
    live, // always set (null when no in-flight turn) so a reconnect clears any stale live blocks
    resumes: state.resumes || [],
  });
}

function wire(set: any, get: () => State) {
  if (wired) return; wired = true;
  const sock = getSocket();
  const isCur = (sessionId: string) => get().current?.chatSessionId === sessionId;

  // On (re)connect — after a network blip or server restart — re-subscribe to the open session's
  // room and pull any messages that landed while we were disconnected. Without this, a turn that
  // completed while the socket was down would never reach this still-open client until a manual
  // reopen (looked like "the conversation wasn't saved").
  sock.on('connect', () => {
    const c = get().current; if (!c) return;
    api.get(`/api/sessions/${c.chatSessionId}`)
      .then((r) => { if (get().current?.chatSessionId === c.chatSessionId && Array.isArray(r.messages)) set({ messages: r.messages }); })
      .catch(() => {});
    sock.emit('session:join', c.chatSessionId, (state: any) => applyJoinState(set, get, c.chatSessionId, state));
  });

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

  // the server named a fresh chat after its topic — update the sidebar row + the open header
  sock.on('session:title', (p: { sessionId: string; title: string }) => {
    set({ sessions: get().sessions.map((s) => (s.id === p.sessionId ? { ...s, title: p.title } : s)) });
    const c = get().current;
    if (c && c.chatSessionId === p.sessionId) set({ current: { ...c, title: p.title } });
  });

  sock.on('turn:error', (p: any) => {
    if (!isCur(p.sessionId)) return;
    // p.resumeAt => the plan window ran out and the turn was parked for an automatic re-run. That is
    // an expected wait, not a failure, so the composer banner reports it instead of the error toast.
    set({ live: null, turnActive: false, error: p.aborted || p.resumeAt ? null : t('common.errorPrefix', { msg: p.error }) });
  });

  // ── auto-resume on the claude.ai window reset ──
  sock.on('turn:resumeScheduled', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const next: PendingResume = { id: p.id, sessionId: p.sessionId, author: p.author, text: p.text || '', attempts: p.attempts || 0, resumeAt: p.resumeAt };
    set({ resumes: [...get().resumes.filter((r) => r.id !== p.id), next] });
  });
  const dropResume = (p: any) => { if (isCur(p.sessionId)) set({ resumes: get().resumes.filter((r) => r.id !== p.id) }); };
  // the 5h-window primer opened a window for this user (fires on every tab they have open)
  sock.on('user:primed', (p: any) => { const u = get().user; if (u) set({ user: { ...u, primedAt: p?.primedAt ?? Date.now() } }); });
  sock.on('turn:resumeFired', dropResume);     // it went back into the queue — queue:update takes over
  sock.on('turn:resumeCancelled', dropResume);

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

  // review poller/pipeline changed the repos/sessions — refresh lists (badges, new PRs, verdicts)
  // and sync the currently-open review header (verdict/merge state) from the refreshed summary.
  sock.on('review:changed', async () => {
    if (!get().user) return;
    await get().refreshLists().catch(() => {});
    const c = get().current;
    if (c?.kind === 'review' && c.reviewId && c.review) {
      const s = get().reviewSessions.find((x) => x.id === c.reviewId);
      if (s) set({ current: { ...c, review: { ...c.review, verdict: s.verdict, verdictSummary: s.verdictSummary, mergeState: s.mergeState, prState: s.prState } } });
    }
  });

  // member request submitted/decided (broadcast to all) — refresh own list + admin pending badge
  sock.on('requests:changed', () => { if (get().user) void get().refreshRequests(); });

  // ── DM / group chat ──
  // A new message in any channel I'm in. If it's the open channel: append + mark read. Always update
  // that channel's sidebar summary (last message + unread bump for background channels I didn't send).
  sock.on('dm:message', (p: { channelId: string; message: DmMessage }) => {
    const st = get();
    const { channelId, message } = p;
    const isActive = st.activeChannelId === channelId;
    const mine = message.userId === st.user?.id;
    if (isActive && !st.channelMessages.some((m) => m.id === message.id)) {
      set({ channelMessages: [...st.channelMessages, message] });
    }
    set({
      channels: get().channels.map((c) => (c.id === channelId
        ? { ...c, lastMessage: { text: message.text, createdAt: message.createdAt, userId: message.userId }, unread: isActive || mine ? c.unread : c.unread + 1 }
        : c)),
    });
    if (isActive) get().markReadDm(channelId); // viewing it → keep it read
  });
  // channel list changed (new channel, unread reset from another tab) — re-pull my channels
  sock.on('dm:channels', () => {
    if (!get().user) return;
    api.get('/api/dm/channels').then((r) => set({ channels: r.channels || [] })).catch(() => {});
  });

  sock.on('queue:update', (p: any) => { if (isCur(p.sessionId)) set({ queue: { running: p.running, waiting: p.waiting } }); });
  sock.on('presence:update', (p: any) => { if (isCur(p.sessionId)) set({ presence: p.users }); });
  sock.on('turn:congested', (p: any) => { if (isCur(p.sessionId)) { set({ congested: true }); setTimeout(() => set({ congested: false }), 4000); } });
}
