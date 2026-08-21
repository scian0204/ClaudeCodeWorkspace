import { create } from 'zustand';
import { api } from './api';
import { getSocket } from './socket';
import { t, getLang, setLang, LANGS, type Lang } from './i18n';

export type Block =
  // parentId set => the block came from a subagent, not the main thread (agentType = its subagent
  // type). Nested text renders in the task panel's live view, not the main transcript.
  | { type: 'text'; text: string; parentId?: string; agentType?: string }
  | { type: 'tool_use'; id: string; name: string; input: any; output?: string; isError?: boolean; parentId?: string; agentType?: string };
// One piece of agent-side work a turn spawned: a Task-tool subagent, a backgrounded shell, a local
// workflow, an MCP monitor. Mirrors server/src/claude/tasks.ts (AgentTask).
export interface AgentTask {
  id: string; toolUseId?: string; kind: string; label: string; agentType?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'killed' | 'paused';
  background: boolean; ambient?: boolean; startedAt: number; endedAt?: number;
  lastTool?: string; tokens?: number; toolUses?: number; durationMs?: number; summary?: string; error?: string;
}
export interface Attachment { name: string; isImage: boolean; url?: string } // url: local preview / demo data URL (real mode falls back to the GET endpoint)
export interface Msg { id: string; role: string; authorId?: string | null; authorName?: string | null; content: any; chat?: boolean; createdAt: number; }
export interface CmdInfo { name: string; description: string; argumentHint: string }
export interface Member { userId: string; displayName: string; avatarColor: string; username: string; isOwner: boolean; delegations: string[]; joinedAt: number; }
export interface RoomSummary { id: string; name: string; ownerId: string; chatSessionId: string; permissionMode: string; members: Member[]; }
export interface PrivateSession { id: string; title: string; updatedAt: number; projectId: string | null; model: string; effort: string; permissionMode: string; }
export interface Project { id: string; scope: string; ownerId: string | null; name: string; path: string; }
export interface WikiTopic { id: string; name: string; description: string; path: string; createdBy: string; createdAt: number; compileStatus?: string; compiledAt?: number | null; compileError?: string | null; autoLearn?: string; kind?: string; }
// A knowledge addition the learner parked for a human to accept ('ask' mode).
export interface WikiProposal { id: string; topicId: string; topicName: string; sessionId: string; title: string; slug: string; content: string; createdAt: number; }
export interface ReviewRepo { id: string; name: string; provider: string; host: string; slug: string; gitUrl: string; baseBranch: string | null; sandboxImage: string | null; polledAt: number | null; pollError: string | null; webhookSecret: string | null; pollEnabled: boolean; openCount: number; createdAt: number; }
export interface ReviewSessionSummary { id: string; chatSessionId: string; repoId: string; repoName: string; prNumber: number; prTitle: string; prUrl: string; prState: string; authorLogin: string; mergeState: string; verdict: string; verdictSummary: string | null; readOnly: boolean; updatedAt: number; }
export interface ReviewMeta { reviewId: string; prNumber: number; prTitle: string; prUrl: string; prState: string; authorLogin: string; baseRef: string; headRef: string; mergeState: string; verdict: string; verdictSummary: string | null; repoName: string; provider: string; }
// hasClaudeToken = a token is pasted; hasClaudeAuth = the user has ANY auth of their own (token,
// browser sign-in, or an LLM provider profile). The nag + sidebar badge key on the latter.
export interface User { id: string; username: string; role: string; displayName: string; avatarColor: string; avatar?: string | null; hasClaudeToken?: boolean; hasClaudeAuth?: boolean; claudeTokenSetAt?: number | null; autoTitle?: boolean; autoResume?: boolean; primeWindow?: boolean; primedAt?: number | null; }
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
// In-flight turn. `outTokens` is the last EXACT output-token total the server reported (turn:usage,
// one per assistant message); `outChars` is the text/thinking streamed since then, which the UI turns
// into an approximate delta so the meter keeps moving between exact updates. `thinking` = the model
// is producing extended-thinking tokens right now (no visible text yet).
// `subDelta` = in-flight partial text per subagent (keyed by the Task call's tool_use id) — the
// task panel's live view streams from it until the completed block lands in `blocks`.
export interface Live { blocks: Block[]; toolMap: Record<string, number>; inTokens: number; outTokens: number; outChars: number; thinking: boolean; subDelta: Record<string, string>; credential: string | null; }
// Guide assistant (the floating corner panel). Its own per-user thread, never a chat session.
export interface GuideMsg { id: string; role: 'user' | 'assistant'; content: { text?: string; blocks?: Block[]; interrupted?: boolean }; createdAt: number; }
export interface QueueState { running: { id: string; author: { id: string; name: string } } | null; waiting: { id: string; author: { id: string; name: string } }[]; }
// A turn parked until the author's claude.ai plan window (5h / weekly) resets — see server/src/claude/auto-resume.ts.
export interface PendingResume { id: string; sessionId: string; author: { id: string; name: string }; text: string; attempts: number; resumeAt: number; }
export interface Control { canApprove: boolean; canInterrupt: boolean; canSetMode: boolean; isOwner: boolean; delegable: string[]; }
export interface PermReq { requestId: string; tool: string; input: any; }
export interface Current { chatSessionId: string; kind: 'private' | 'room' | 'review'; roomId?: string; wikiTopicId?: string; wikiRefId?: string | null; reviewId?: string; review?: ReviewMeta; readOnly?: boolean; title: string; projectId: string | null; model: string; effort: string; permissionMode: string; agent?: string | null; poolId?: string | null; sandbox?: number; watchMode?: string; watchPrompt?: string; room?: RoomSummary; }
// A file change in the project a session watches, as `project:changed` reports it. `fired` = the
// session's stored prompt went out as a turn ('prompt' mode).
export interface ProjectChange { sessionId: string; projectId: string; projectName: string; files: string[]; count: number; at: number; mode?: string; self?: boolean; fired?: boolean; }

// A shared-plan pool ("토큰 모아쓰기") and its members, as /api/pools reports them.
export interface PoolMember { userId: string; name: string; priority: number; hasCredential: boolean; cooldownUntil: number; }
export interface Pool { id: string; name: string; ownerId: string; ownerName: string; strategy: string; isGlobal: boolean; members: PoolMember[]; }

// Workspace branding (GET /api/brand): an admin-set title + logo, both optional. `logo` is a
// cache-bust version token (the logo file's mtime) — or a data: URL in the static demo.
export interface Brand { title: string; logo: string | null }

interface State {
  user: User | null;
  brand: Brand;
  theme: 'light' | 'dark' | null;
  sessions: PrivateSession[];
  rooms: RoomSummary[];
  wikiTopics: WikiTopic[];
  reviewRepos: ReviewRepo[];
  reviewSessions: ReviewSessionSummary[];
  wikiProgress: Record<string, string>; // topicId -> latest compile step (transient)
  wikiProposals: WikiProposal[]; // knowledge the learner parked for the open thread ('ask' mode)
  wikiLearned: { id: string; topicName: string; title: string }[]; // 'auto' mode additions, announced once
  projects: { common: Project[]; mine: Project[] };
  current: Current | null;
  messages: Msg[];
  live: Live | null;
  turnActive: boolean;
  tasks: AgentTask[];            // open session's subagents / background shells / workflows
  taskPanelEnabled: boolean;     // admin feature flag (from /api/config) — off hides the panel entirely
  tasksOpen: boolean;            // right-side task panel open (persisted)
  queue: QueueState;
  pending: PermReq[];
  control: Control;
  presence: { id: string; name: string; color: string }[];
  congested: boolean;
  sessionImportEnabled: boolean; // admin feature flag (from /api/config)
  sessionExportEnabled: boolean; // admin feature flag (from /api/config) — gates the session-download UI
  sessionBundleEnabled: boolean; // same, for the heavier "whole project folder" download option
  fileTreeWarnCount: number;     // admin setting — folders with more entries ask before opening
  teamAgentsEnabled: boolean;    // admin feature flag (from /api/config) — gates the team-agents UI
  llmProvidersEnabled: boolean;  // admin feature flag (from /api/config) — gates the LLM provider UI
  approvalsEnabled: boolean;     // admin feature flag (from /api/config) — gates the member-request UI
  dmEnabled: boolean;            // admin feature flag (from /api/config) — gates the DM/group chat UI
  searchEnabled: boolean;        // admin feature flag (from /api/config) — gates the unified-search UI
  dockerReady: boolean;          // daemon reachable AND wired (from /api/config) — gates the editor views
  dockerReason: string;          // why not: socket-missing | denied | unreachable | unconfigured | ok
  customContextMenuEnabled: boolean; // admin feature flag (from /api/config) — off = browser's own right-click menu everywhere
  gitPublishEnabled: boolean;    // admin feature flag (from /api/config) — gates git publish in the Git panel
  autoTitleEnabled: boolean;     // admin feature flag (from /api/config) — gates the auto session-title toggle
  titling: string[];             // sessions the server is naming right now (session:titling) — drives the waiting mark
  autoResumeEnabled: boolean;    // admin feature flag (from /api/config) — gates the 5h-reset auto-resume toggle
  resumes: PendingResume[];      // open session's turns parked for a claude.ai window reset
  windowPrimerEnabled: boolean;  // admin feature flag (from /api/config) — gates the 5h-window primer toggle
  wikiSourceEditEnabled: boolean; // admin feature flag (from /api/config) — gates wiki raw/ source add+edit
  wikiLinkEnabled: boolean;       // admin feature flag — gates linking a topic to an ordinary session
  wikiAutoLearnEnabled: boolean;  // admin feature flag — gates growing a topic from conversations
  reviewWebhookEnabled: boolean;  // admin feature flag (from /api/config) — gates the PR-review webhook UI
  // ── guide assistant (floating corner panel) ──
  guideEnabled: boolean;         // admin feature flag (from /api/config) — off hides the button entirely
  guideWriteEnabled: boolean;    // admin feature flag — off = the guide explains but never changes state
  guideOpen: boolean;            // panel open
  guideLoaded: boolean;          // history pulled at least once (first open)
  guideMessages: GuideMsg[];
  guideLive: Live | null;        // in-flight answer (streamed blocks)
  guideBusy: boolean;
  guideUnread: boolean;          // an answer landed while the panel was closed → dot on the button
  // ── side chat (the CLI's /btw): a floating window over the open chat ──
  // Not persisted anywhere, on purpose: the whole promise is that it never joins the conversation,
  // so it lives in this tab and dies with it. The server keeps only the forked CLI session id.
  asideEnabled: boolean;         // admin feature flag (from /api/config) — off hides it entirely
  asideOpen: boolean;
  asideMessages: GuideMsg[];
  asideLive: Live | null;
  asideBusy: boolean;
  searchOpen: boolean;           // unified-search palette (Ctrl/Cmd+K)
  shortcutsOpen: boolean;        // keyboard-shortcut cheat sheet (?)
  highlightMsgId: string | null; // message a search hit jumped to (scroll target + ring)
  processPollMs: number;         // admin process panel auto-poll interval (from /api/config)
  toolFoldMin: number;           // fold a run of N+ back-to-back tool calls into one row (0 = never)
  pools: Pool[];                 // shared-plan pools ("토큰 모아쓰기") — /api/pools
  poolAllUsers: boolean;         // admin mode: everyone with a plan shares — the last fallback
  poolOptedOut: boolean;         // this user keeps their own plan out of that workspace-wide pool
  myPoolId: string | null;       // this user's own pool (their party) — one level more specific
  poolCanCreate: boolean;        // this user may start a party pool
  poolHasCredential: boolean;    // this user has a Claude plan to contribute
  tokenPoolEnabled: boolean;     // admin feature flag (from /api/config) — gates the shared-plan pool UI
  sessionSandboxEnabled: boolean; // admin feature flag (from /api/config) — gates the per-session build container
  projectWatchEnabled: boolean;   // admin feature flag (from /api/config) — gates the project file-change watch
  projectWatchPromptEnabled: boolean; // same, for the auto-sent prompt mode on top of it
  projectWatchPromptMax: number;  // admin setting — length cap on that stored prompt
  projectChanges: Record<string, ProjectChange>; // sessionId -> its latest unseen project change
  channels: DmChannel[];         // DM + group chat channels the user belongs to
  activeChannelId: string | null; // open DM/group channel (main panel shows DmView when set)
  channelMessages: DmMessage[];  // messages of the open channel
  requests: AdminRequest[];      // member: own requests; admin: all
  pendingRequestCount: number;   // admins only — drives the sidebar admin-panel badge
  // admins only — a newer image is published (last cached check, from /api/config). Highlights the
  // sidebar's admin-panel button; the panel's own banner reads the fuller admin overview.
  updateAvailable: boolean;
  updateLatest: string | null;
  viewMode: 'chat' | 'split' | 'editor';
  editorUrl: string | null;
  gitPanelOpen: boolean;   // header Git panel (store-lifted so the Mod+Shift+G shortcut can drive it)
  explorerOpen: boolean;   // header project file explorer (same, Mod+Shift+F)
  exportOpen: boolean;     // transcript export dialog (same, so /export can open it)
  panel: null | 'admin' | 'plugins' | 'agents' | 'me';
  sidebarOpen: boolean; // mobile off-canvas drawer (ignored ≥md, sidebar is a static column there)
  sidebarCollapsed: boolean; // ≥md only: hide the sidebar column (persisted; <md the drawer rules instead)
  error: string | null;
  commands: CmdInfo[];

  bootstrap: () => Promise<void>;
  refreshBrand: () => Promise<void>;
  saveBrandTitle: (title: string) => Promise<void>;
  uploadBrandLogo: (file: File) => Promise<void>;
  clearBrandLogo: () => Promise<void>;
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
  setGuideOpen: (open: boolean) => void;
  sendGuide: (text: string) => Promise<void>;
  clearGuideThread: () => Promise<void>;
  interruptGuide: () => Promise<void>;
  setAsideOpen: (open: boolean) => void;
  sendAside: (text: string) => Promise<void>;
  clearAsideThread: () => Promise<void>;
  interruptAside: () => Promise<void>;
  setHighlightMsgId: (id: string | null) => void;
  openHit: (hit: SearchHit) => Promise<void>;
  sendDm: (text: string) => void;
  createDm: (userId: string) => Promise<void>;
  createGroup: (name: string, memberIds: string[]) => Promise<void>;
  promoteChannel: (id: string) => Promise<void>;
  markReadDm: (id: string) => void;
  newReviewRepo: (payload: { name?: string; gitUrl: string; credentialId: string; provider?: string; baseBranch?: string; sandboxImage?: string; webhook?: boolean; pollEnabled?: boolean }) => Promise<ReviewRepo | undefined>;
  updateReviewRepo: (id: string, payload: { name?: string; baseBranch?: string; sandboxImage?: string; credentialId?: string; pollEnabled?: boolean }) => Promise<void>;
  deleteReviewRepo: (id: string) => Promise<void>;
  pollReviewRepo: (id: string) => Promise<void>;
  setReviewWebhook: (id: string, enabled: boolean) => Promise<string | null>;
  mergeReview: (reviewId: string) => Promise<{ mergeState: string; output: string }>;
  autoReviewRun: (reviewId: string) => Promise<void>;
  approveReview: (reviewId: string) => Promise<{ output: string }>;
  newSession: (projectId?: string) => Promise<void>;
  importSessions: (payload: { sid: string; projectName?: string; sessionUuids: string[]; autoTitle: boolean; overwrite: string[]; projectOverwrite: boolean; projectWipe: boolean }) => Promise<{ project: any; sessions: any[] }>;
  newRoom: (name: string) => Promise<void>;
  newWikiTopic: (payload: { name: string; description: string; stagingId?: string; precompiled?: boolean; seedType?: string; seedSessionId?: string; seedProjectId?: string; autoLearn?: string; kind?: string }) => Promise<void>;
  updateWikiTopic: (id: string, patch: { name?: string; description?: string; autoLearn?: string }) => Promise<void>;
  setWikiRef: (topicId: string | null) => Promise<void>;
  decideWikiProposal: (id: string, accept: boolean) => Promise<void>;
  dismissWikiLearned: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  retitleSession: (id: string) => Promise<void>;
  deleteRoom: (id: string) => Promise<void>;
  deleteWikiTopic: (id: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, text: string) => Promise<void>;
  send: (text: string, opts?: { chat?: boolean; includeChat?: boolean; attachments?: Attachment[] }) => void;
  cancel: (itemId: string) => void;
  interrupt: () => void;
  respond: (requestId: string, decision: 'allow' | 'deny' | 'always' | 'answer', answer?: string) => void;
  setTasksOpen: (open: boolean) => void;
  setGitPanelOpen: (open: boolean) => void;
  setExplorerOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;
  setViewMode: (m: 'chat' | 'split' | 'editor') => void;
  openEditor: () => Promise<void>;
  setProject: (projectId: string | null) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setEffort: (effort: string) => Promise<void>;
  setPool: (poolId: string | null) => Promise<void>;
  setSandbox: (on: boolean) => Promise<void>;
  setWatch: (mode: string, prompt?: string) => Promise<void>;
  dismissProjectChange: (sessionId: string) => void;
  setMyPool: (poolId: string | null) => Promise<void>;
  setPoolOptOut: (optOut: boolean) => Promise<void>;
  refreshPools: () => Promise<void>;
  setMode: (mode: string) => Promise<void>;
  reloadRoom: () => Promise<void>;
  setPanel: (p: null | 'admin' | 'plugins' | 'agents' | 'me') => void;
  setAgent: (name: string | null) => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setError: (e: string | null) => void;
  setAutoTitle: (on: boolean) => Promise<void>;
  setAutoResume: (on: boolean) => Promise<void>;
  setPrimeWindow: (on: boolean) => Promise<void>;
  cancelResume: (id: string) => void;
  refreshMe: () => Promise<void>;
  saveClaudeToken: (token: string) => Promise<void>;
  clearClaudeToken: () => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  clearAvatar: () => Promise<void>;
}

const emptyLive = (): Live => ({ blocks: [], toolMap: {}, inTokens: 0, outTokens: 0, outChars: 0, thinking: false, subDelta: {}, credential: null });

let wired = false;

export const useStore = create<State>((set, get) => ({
  user: null,
  brand: { title: '', logo: null },
  theme: (localStorage.getItem('theme') as any) || null,
  sessions: [], rooms: [], wikiTopics: [], reviewRepos: [], reviewSessions: [], wikiProgress: {}, wikiProposals: [], wikiLearned: [], projectChanges: {}, projects: { common: [], mine: [] },
  current: null, messages: [], live: null, turnActive: false,
  tasks: [], taskPanelEnabled: true, tasksOpen: localStorage.getItem('tasksOpen') === '1',
  queue: { running: null, waiting: [] }, pending: [],
  control: { canApprove: true, canInterrupt: true, canSetMode: true, isOwner: true, delegable: [] },
  presence: [], congested: false, sessionImportEnabled: true, sessionExportEnabled: true, sessionBundleEnabled: true, fileTreeWarnCount: 300, teamAgentsEnabled: true, llmProvidersEnabled: true, approvalsEnabled: true, dmEnabled: true, searchEnabled: true, customContextMenuEnabled: true, autoTitleEnabled: true, autoResumeEnabled: true, windowPrimerEnabled: true, gitPublishEnabled: true, wikiSourceEditEnabled: true, wikiLinkEnabled: true, wikiAutoLearnEnabled: true, reviewWebhookEnabled: true, dockerReady: true, dockerReason: 'ok',
  guideEnabled: true, guideWriteEnabled: true, guideOpen: false, guideLoaded: false, guideMessages: [], guideLive: null, guideBusy: false, guideUnread: false,
  asideEnabled: true, asideOpen: false, asideMessages: [], asideLive: null, asideBusy: false,
  resumes: [], searchOpen: false, shortcutsOpen: false, highlightMsgId: null, processPollMs: 5000, toolFoldMin: 3, tokenPoolEnabled: false, sessionSandboxEnabled: false, projectWatchEnabled: true, projectWatchPromptEnabled: true, projectWatchPromptMax: 2000, pools: [], poolAllUsers: false, poolOptedOut: false, myPoolId: null, poolCanCreate: false, poolHasCredential: false, requests: [], pendingRequestCount: 0, updateAvailable: false, updateLatest: null, viewMode: 'chat', editorUrl: null, gitPanelOpen: false, explorerOpen: false, exportOpen: false, panel: null, sidebarOpen: false, sidebarCollapsed: localStorage.getItem('sidebarCollapsed') === '1', error: null,
  channels: [], activeChannelId: null, channelMessages: [], titling: [],
  commands: [],

  bootstrap: async () => {
    applyTheme(get().theme);
    await get().refreshBrand(); // public endpoint — the login card is branded too
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
    set({ user: null, current: null, messages: [], sessions: [], rooms: [], wikiTopics: [], wikiProposals: [], wikiLearned: [], projectChanges: {}, reviewRepos: [], reviewSessions: [], requests: [], pendingRequestCount: 0, updateAvailable: false, updateLatest: null, channels: [], activeChannelId: null, channelMessages: [], searchOpen: false, shortcutsOpen: false, highlightMsgId: null,
      guideOpen: false, guideLoaded: false, guideMessages: [], guideLive: null, guideBusy: false, guideUnread: false,
      asideOpen: false, asideMessages: [], asideLive: null, asideBusy: false });
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
      sessionExportEnabled: cf.sessionExportEnabled !== false,
      sessionBundleEnabled: cf.sessionBundleEnabled !== false,
      fileTreeWarnCount: typeof cf.fileTreeWarnCount === 'number' ? cf.fileTreeWarnCount : 300,
      teamAgentsEnabled: cf.teamAgentsEnabled !== false,
      llmProvidersEnabled: cf.llmProvidersEnabled !== false,
      approvalsEnabled: cf.approvalsEnabled !== false,
      dmEnabled: cf.dmEnabled !== false,
      searchEnabled: cf.searchEnabled !== false,
      customContextMenuEnabled: cf.customContextMenu !== false,
      autoTitleEnabled: cf.autoTitleEnabled !== false,
      gitPublishEnabled: cf.gitPublishEnabled !== false,
      autoResumeEnabled: cf.autoResumeEnabled !== false,
      windowPrimerEnabled: cf.windowPrimerEnabled !== false,
      wikiSourceEditEnabled: cf.wikiSourceEditEnabled !== false,
      wikiLinkEnabled: cf.wikiLinkEnabled !== false,
      wikiAutoLearnEnabled: cf.wikiAutoLearnEnabled !== false,
      reviewWebhookEnabled: cf.reviewWebhookEnabled !== false,
      guideEnabled: cf.guideEnabled !== false,
      guideWriteEnabled: cf.guideWriteEnabled !== false,
      asideEnabled: cf.asideEnabled !== false,
      taskPanelEnabled: cf.taskPanelEnabled !== false,
      channels: dmc.channels || [],
      processPollMs: cf.processPollMs || 5000,
      toolFoldMin: cf.toolFoldMin ?? 3,
      tokenPoolEnabled: cf.tokenPoolEnabled === true,
      sessionSandboxEnabled: cf.sessionSandboxEnabled === true,
      projectWatchEnabled: cf.projectWatchEnabled !== false,
      projectWatchPromptEnabled: cf.projectWatchPromptEnabled !== false,
      projectWatchPromptMax: cf.projectWatchPromptMaxChars || 2000,
      dockerReady: cf.dockerReady !== false,
      dockerReason: cf.dockerReason || 'ok',
      updateAvailable: cf.updateAvailable === true, // absent for non-admins
      updateLatest: cf.updateLatest || null,
    });
    await get().refreshRequests();
    await get().refreshPools();
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
      agent: session.agent ?? null, poolId: session.poolId ?? null, sandbox: session.sandbox ?? 0,
      wikiRefId: session.wikiRefId ?? null,
      watchMode: session.watchMode || 'off', watchPrompt: session.watchPrompt || '',
    }, messages);
  },

  openRoom: async (roomId) => {
    const { room, messages } = await api.get(`/api/rooms/${roomId}`);
    const chat = await api.get(`/api/sessions/${room.chatSessionId}`).catch(() => null);
    await join(set, get, {
      chatSessionId: room.chatSessionId, kind: 'room', roomId: room.id, title: room.name,
      projectId: chat?.session?.projectId ?? null, model: chat?.session?.model || 'claude-opus-4-8',
      effort: chat?.session?.effort || 'high', permissionMode: room.permissionMode, agent: chat?.session?.agent ?? null,
      poolId: chat?.session?.poolId ?? null, sandbox: chat?.session?.sandbox ?? 0,
      wikiRefId: chat?.session?.wikiRefId ?? null,
      watchMode: chat?.session?.watchMode || 'off', watchPrompt: chat?.session?.watchPrompt || '', room,
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
  // returns the created repo — the caller shows its freshly issued webhook URL/secret
  newReviewRepo: async (payload) => {
    const r = await api.post('/api/review/repos', payload);
    await get().refreshLists();
    return r.repo as ReviewRepo | undefined;
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
  // issue/rotate (enabled) or clear (disabled) the repo's webhook secret; returns the new secret
  setReviewWebhook: async (id, enabled) => {
    const r = await api.post(`/api/review/repos/${id}/webhook`, { enabled });
    await get().refreshLists();
    return r.secret ?? null;
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
      current: null, messages: [], live: null, turnActive: false, tasks: [],
      queue: { running: null, waiting: [] }, pending: [], presence: [], commands: [],
      activeChannelId: null, channelMessages: [], highlightMsgId: null,
      panel: null, viewMode: 'chat', editorUrl: null, gitPanelOpen: false, explorerOpen: false, exportOpen: false, sidebarOpen: false,
    });
  },

  // ── unified search ──
  // ── guide assistant ──
  // History is pulled on the FIRST open only; after that the socket keeps it live (including turns
  // this tab did not start), so reopening the panel is instant.
  setGuideOpen: (open) => {
    set({ guideOpen: open, ...(open ? { guideUnread: false, sidebarOpen: false } : {}) });
    if (!open || get().guideLoaded) return;
    api.get('/api/guide/messages')
      .then((r) => set({ guideMessages: r.messages || [], guideBusy: !!r.busy, guideLoaded: true }))
      .catch(() => set({ guideLoaded: true })); // disabled/offline → empty thread, the send will report
  },
  sendGuide: async (text) => {
    const t = text.trim(); if (!t || get().guideBusy) return;
    set({ guideBusy: true }); // optimistic: the composer locks before the socket echoes the message
    try { await api.post('/api/guide/message', { text: t, lang: getLang() }); }
    catch (e: any) { set({ guideBusy: false, error: e.message }); }
  },
  clearGuideThread: async () => {
    set({ guideMessages: [], guideLive: null, guideBusy: false });
    await api.del('/api/guide/messages').catch(() => {});
  },
  interruptGuide: async () => { await api.post('/api/guide/interrupt').catch(() => {}); },

  // ── side chat ──
  // The question is echoed locally rather than waiting for the server, because the server never
  // stores it: there is nothing to load back and nothing to reconcile with.
  setAsideOpen: (open) => set({ asideOpen: open, ...(open ? { sidebarOpen: false } : {}) }),
  sendAside: async (text) => {
    const st = get();
    const c = st.current; if (!c) return;
    const t2 = text.trim(); if (!t2 || st.asideBusy) return;
    set({
      asideBusy: true,
      asideMessages: [...st.asideMessages, { id: crypto.randomUUID(), role: 'user', content: { text: t2 }, createdAt: Date.now() }],
    });
    try { await api.post(`/api/sessions/${c.chatSessionId}/aside`, { text: t2 }); }
    catch (e: any) { set({ asideBusy: false, error: e.message }); }
  },
  clearAsideThread: async () => {
    const c = get().current;
    set({ asideMessages: [], asideLive: null, asideBusy: false });
    if (c) await api.del(`/api/sessions/${c.chatSessionId}/aside`).catch(() => {});
  },
  interruptAside: async () => {
    const c = get().current; if (!c) return;
    await api.post(`/api/sessions/${c.chatSessionId}/aside/interrupt`).catch(() => {});
  },

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

  newSession: async (projectId) => {
    const { session } = await api.post('/api/sessions', projectId ? { projectId } : {});
    await get().refreshLists();
    await get().openPrivate(session.id);
  },

  importSessions: async (payload) => {
    const r = await api.post('/api/import/sessions', payload);
    await get().refreshLists();
    return r;
  },

  updateWikiTopic: async (id, patch) => {
    const { topic } = await api.patch(`/api/wiki/topics/${id}`, patch);
    set({ wikiTopics: get().wikiTopics.map((t) => (t.id === id ? { ...t, ...topic } : t)) });
  },
  // Link (or unlink) a wiki topic to the OPEN session — the reverse of opening the topic itself.
  // A room's shared chat row carries it too, so every member's turns see the same knowledge.
  setWikiRef: async (topicId) => {
    const c = get().current; if (!c) return;
    await api.patch(`/api/sessions/${c.chatSessionId}`, { wikiRefId: topicId });
    set({ current: { ...c, wikiRefId: topicId } });
  },
  decideWikiProposal: async (id, accept) => {
    await api.post(`/api/wiki/proposals/${id}/decide`, { accept });
    set({ wikiProposals: get().wikiProposals.filter((p) => p.id !== id) });
  },
  dismissWikiLearned: (id) => set({ wikiLearned: get().wikiLearned.filter((x) => x.id !== id) }),
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
  // Manual LLM naming. Applied locally too: the server also emits session:title, but a client that
  // has not joined this session's room would otherwise see nothing happen.
  // The waiting mark is driven from here rather than from a busy flag per button, so the row, the
  // header title and every naming spot wait together — and `session:titling` from another tab or
  // from the first-turn naming lights up exactly the same UI.
  retitleSession: async (id) => {
    set({ titling: [...get().titling.filter((x) => x !== id), id] });
    try {
      const { title } = await api.post(`/api/sessions/${id}/retitle`, {});
      if (!title) return;
      set({ sessions: get().sessions.map((s) => (s.id === id ? { ...s, title } : s)) });
      const c = get().current;
      if (c && c.chatSessionId === id) set({ current: { ...c, title } });
    } finally {
      set({ titling: get().titling.filter((x) => x !== id) });
    }
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

  setTasksOpen: (open) => { localStorage.setItem('tasksOpen', open ? '1' : '0'); set({ tasksOpen: open, sidebarOpen: false }); },
  setGitPanelOpen: (open) => set({ gitPanelOpen: open }),
  setExplorerOpen: (open) => set({ explorerOpen: open }),
  setExportOpen: (open) => set({ exportOpen: open }),

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
    // patch the list too — the sidebar groups chats by project, so the row has to move right away
    set({ current: { ...c, projectId }, editorUrl: null,
      sessions: get().sessions.map((s) => (s.id === c.chatSessionId ? { ...s, projectId } : s)) });
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
  // main-thread team agent for this session ("next turn onward"). Rooms PATCH too — unlike setModel,
  // the room's shared chat_sessions row is what runTurn reads, and the server allows member edits.
  setAgent: async (name) => {
    const c = get().current; if (!c) return;
    await api.patch(`/api/sessions/${c.chatSessionId}`, { agent: name || null });
    set({ current: { ...c, agent: name || null } });
  },
  setEffort: async (effort) => {
    const c = get().current; if (!c) return;
    if (c.kind === 'private' || c.kind === 'review') await api.patch(`/api/sessions/${c.chatSessionId}`, { effort });
    set({ current: { ...c, effort } });
  },
  // Whose Claude plan this session's turns draw from. '' = the workspace-wide pool (or the sender's
  // own plan when none is set). Rooms PATCH too: their shared chat_sessions row is what runTurn reads.
  setPool: async (poolId) => {
    const c = get().current; if (!c) return;
    await api.patch(`/api/sessions/${c.chatSessionId}`, { poolId: poolId || '' });
    set({ current: { ...c, poolId: poolId || null } });
  },
  setSandbox: async (on) => {
    const c = get().current; if (!c) return;
    await api.patch(`/api/sessions/${c.chatSessionId}`, { sandbox: on ? 1 : 0 });
    set({ current: { ...c, sandbox: on ? 1 : 0 } });
  },
  // Watch this session's project for changes made outside it. 'prompt' mode also needs the text to
  // send, so both fields go in one PATCH — the server refuses 'prompt' with an empty prompt.
  setWatch: async (mode, prompt) => {
    const c = get().current; if (!c) return;
    const body: any = { watchMode: mode };
    if (prompt !== undefined) body.watchPrompt = prompt;
    await api.patch(`/api/sessions/${c.chatSessionId}`, body);
    set({ current: { ...c, watchMode: mode, watchPrompt: prompt !== undefined ? prompt : c.watchPrompt } });
  },
  dismissProjectChange: (sessionId) => {
    const next = { ...get().projectChanges };
    delete next[sessionId];
    set({ projectChanges: next });
  },
  // this user's own default pool — sits under a session's explicit choice, over the workspace one
  setMyPool: async (poolId) => {
    await api.put('/api/pools/my-default', { poolId: poolId || '' });
    await get().refreshPools();
  },
  // keep my own plan out of the workspace-wide "everyone shares" pool
  setPoolOptOut: async (optOut) => {
    await api.put('/api/pools/opt-out', { optOut });
    await get().refreshPools();
  },
  refreshPools: async () => {
    if (!get().tokenPoolEnabled) return;
    try {
      const r = await api.get('/api/pools');
      set({ pools: r.pools || [], poolAllUsers: !!r.allUsers, poolOptedOut: !!r.optedOut, myPoolId: r.myPoolId || null, poolCanCreate: !!r.canCreate, poolHasCredential: !!r.hasCredential });
    } catch { /* pooling off or not reachable — leave the last list alone */ }
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

  // Re-read /me after auth changes that don't return the user DTO themselves (browser sign-in,
  // provider profile saved/cleared) so hasClaudeAuth — and with it the nag — updates without a reload.
  refreshMe: async () => {
    try { const { user } = await api.get('/api/auth/me'); set({ user }); } catch { /* stale session — the app already handles that */ }
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

  // ── branding (title + logo) ──
  refreshBrand: async () => {
    try { setBrand(set, await api.get('/api/brand')); } catch { /* keep the built-in branding */ }
  },
  saveBrandTitle: async (title) => { setBrand(set, await api.put('/api/admin/brand', { title })); },
  uploadBrandLogo: async (file) => {
    const form = new FormData();
    form.append('logo', file, file.name);
    setBrand(set, await api.upload('/api/admin/brand/logo', form));
  },
  clearBrandLogo: async () => { setBrand(set, await api.del('/api/admin/brand/logo')); },
}));

// ── branding helpers ──
// Fallback name when no custom title is set. Not i18n'd on purpose: it's the product's own name.
export const BRAND_NAME = 'ClaudeCode Workspace';

// <img src> for the custom logo, or the bundled favicon when none is set. A data: URL (static demo)
// is used as-is; otherwise the version token busts the browser cache on every change.
export function brandLogoUrl(brand: Brand): string {
  if (!brand.logo) return `${import.meta.env.BASE_URL}favicon.svg`;
  return brand.logo.startsWith('data:') ? brand.logo : `/api/brand/logo?v=${encodeURIComponent(brand.logo)}`;
}

// Everything the chrome needs to render the brand: resolved title + logo src.
export function useBrand(): { title: string; logo: string } {
  const brand = useStore((s) => s.brand);
  return { title: brand.title || BRAND_NAME, logo: brandLogoUrl(brand) };
}

function setBrand(set: any, brand: Brand) {
  const next: Brand = { title: brand?.title || '', logo: brand?.logo ?? null };
  set({ brand: next });
  document.title = next.title || BRAND_NAME;
  // keep the tab icon in step with the sidebar mark (every rel=icon link, incl. apple-touch-icon)
  const href = brandLogoUrl(next);
  document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]')
    .forEach((l) => { l.href = href; });
}

// Apply one `guide:action` from the assistant. Mirror of server/src/guide/ui-actions.ts — an action
// missing here is an action the agent thinks it has, so keep the two tables in step.
// Admin-scoped actions are re-checked client-side: the server already filters them out per role,
// this is the second lock (and it keeps a member out of a panel whose every call would 403 anyway).
// Git panel / file explorer / the split view only exist on a chat that has a working directory —
// mirrors the pill gating in Chat.tsx and the shortcut gates in lib/shortcuts.ts.
const projectPanels = (s: State) => !!s.current?.projectId && !s.current.wikiTopicId && s.current.kind !== 'review';

async function applyGuideAction(get: () => State, action: string, value: string | null): Promise<void> {
  const s = get();
  const v = value || '';
  switch (action) {
    case 'openSession': if (v) await s.openPrivate(v).catch(() => {}); break;
    case 'openRoom': if (v) await s.openRoom(v).catch(() => {}); break;
    case 'openWiki': if (v) await s.openWiki(v).catch(() => {}); break;
    case 'openReview': if (v) await s.openReview(v).catch(() => {}); break;
    case 'openChannel': if (v) await s.openChannel(v).catch(() => {}); break;
    case 'openPanel': if (v === 'plugins' || v === 'agents' || v === 'me') s.setPanel(v); break;
    case 'openAdmin': if (s.user?.role === 'admin') s.setPanel('admin'); break;
    case 'newChat': await s.newSession().catch(() => {}); break;
    case 'goHome': s.goHome(); break;
    case 'openShortcuts': s.setShortcutsOpen(true); break;
    case 'openSearch': if (s.searchEnabled) s.setSearchOpen(true); break;
    // The chat-side panels. Same gates the Mod+Shift+E/G/F shortcuts use — an action fired for a
    // screen that has no such panel is dropped rather than leaving a panel open over nothing.
    case 'openTasks': if (s.taskPanelEnabled && s.current) s.setTasksOpen(v !== 'off'); break;
    case 'openGit': if (projectPanels(s)) s.setGitPanelOpen(v !== 'off'); break;
    case 'openFiles': if (projectPanels(s)) s.setExplorerOpen(v !== 'off'); break;
    case 'openExport': if (s.sessionExportEnabled && s.current) s.setExportOpen(true); break;
    case 'openAside': if (s.asideEnabled && s.current) s.setAsideOpen(v !== 'off'); break;
    case 'setView':
      if ((v === 'chat' || v === 'split' || v === 'editor') && projectPanels(s)
        && (v === 'chat' || (s.dockerReady && !window.matchMedia('(max-width: 767px)').matches))) s.setViewMode(v);
      break;
    case 'setLanguage': if ((LANGS as readonly string[]).includes(v)) setLang(v as Lang); break;
    case 'setTheme': if (v === 'light' || v === 'dark') setTheme(v); break;
    case 'toggleSidebar':
      if (window.matchMedia('(max-width: 767px)').matches) s.setSidebarOpen(!s.sidebarOpen);
      else s.setSidebarCollapsed(!s.sidebarCollapsed);
      break;
    case 'refresh': await s.refreshLists().catch(() => {}); break;
    default: break; // unknown action (older client, newer server) → ignore rather than throw
  }
}

function setTheme(theme: 'light' | 'dark') {
  localStorage.setItem('theme', theme);
  useStore.setState({ theme });
  applyTheme(theme);
}

function applyTheme(theme: 'light' | 'dark' | null) {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

async function join(set: any, get: () => State, cur: Current, messages: Msg[]) {
  const sock = getSocket();
  const prev = get().current;
  if (prev) sock.emit('session:leave', prev.chatSessionId);
  set({
    current: cur, messages, live: null, turnActive: false, tasks: [],
    queue: { running: null, waiting: [] }, pending: [], presence: [],
    viewMode: 'chat', editorUrl: null, gitPanelOpen: false, explorerOpen: false, exportOpen: false, // a switched thread must not inherit a panel aimed at the previous project
    commands: [], sidebarOpen: false, // opening a thread closes the mobile drawer
    asideOpen: false, asideMessages: [], asideLive: null, asideBusy: false, // the side chat belongs to the thread it was asked in
    highlightMsgId: null, // a plain thread switch drops any search-hit highlight
    wikiProposals: [], wikiLearned: [], // parked knowledge belongs to the thread it came out of
    activeChannelId: null, channelMessages: [], // opening a Claude thread hides any open DM view
  });
  // knowledge the learner parked for this thread while it was closed ('ask' mode) — non-blocking
  if (get().wikiAutoLearnEnabled) {
    api.get(`/api/wiki/proposals?sessionId=${cur.chatSessionId}`)
      .then((r) => { if (get().current?.chatSessionId === cur.chatSessionId) set({ wikiProposals: r.proposals || [] }); })
      .catch(() => {});
  }
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
    live = { ...emptyLive(), blocks: lb, toolMap };
  }
  set({
    queue: state.queue || { running: null, waiting: [] },
    pending: state.pending || [],
    control: state.control || get().control,
    turnActive: !!state.queue?.running || !!live,
    live, // always set (null when no in-flight turn) so a reconnect clears any stale live blocks
    resumes: state.resumes || [],
    tasks: state.tasks || [], // subagents / background shells the session spawned (replaces on rejoin)
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

  sock.on('turn:start', (p: any) => {
    if (isCur(p.sessionId)) set({ live: { ...emptyLive(), credential: p.credential || null }, turnActive: true, congested: false });
  });

  // shared-plan pool: the member we started on had no allowance left, so the turn moved to the next
  sock.on('turn:poolFallback', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    set({ live: { ...live, credential: p.credential || null } });
  });

  sock.on('assistant:delta', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    const blocks = live.blocks.slice();
    const last = blocks[blocks.length - 1];
    // never merge into a subagent's text block — main-thread text starts its own block
    if (last && last.type === 'text' && !last.parentId) blocks[blocks.length - 1] = { type: 'text', text: last.text + p.text };
    else blocks.push({ type: 'text', text: p.text });
    // visible text means the thinking phase is over
    set({ live: { ...live, blocks, thinking: false, outChars: live.outChars + String(p.text || '').length } });
  });

  // subagent partial text — streams into the task panel's live view, never the main transcript
  sock.on('subagent:delta', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    set({ live: { ...live, subDelta: { ...live.subDelta, [p.parentId]: (live.subDelta[p.parentId] || '') + p.text }, outChars: live.outChars + String(p.text || '').length } });
  });

  // a subagent finished a text block — the completed block replaces its delta buffer
  sock.on('subagent:block', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    const blocks = [...live.blocks, { type: 'text', text: p.text, parentId: p.parentId, agentType: p.agentType } as Block];
    const subDelta = { ...live.subDelta };
    delete subDelta[p.parentId];
    set({ live: { ...live, blocks, subDelta } });
  });

  // extended thinking is streaming: nothing to render, but the turn is demonstrably alive and the
  // tokens count toward the output meter (server sends the length only, never the thinking text)
  sock.on('assistant:thinking', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    set({ live: { ...live, thinking: true, outChars: live.outChars + (Number(p.len) || 0) } });
  });

  // exact token totals from the SDK — replaces the estimate accumulated since the last one.
  // Input arrives at the start of each agent-loop iteration, output at its end.
  sock.on('turn:usage', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    set({ live: { ...live,
      inTokens: Number(p.inputTokens) || live.inTokens,
      outTokens: Number(p.outputTokens) || live.outTokens,
      outChars: 0 } });
  });

  sock.on('tool:use', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().live || emptyLive();
    const blocks = live.blocks.slice();
    const idx = blocks.push({ type: 'tool_use', id: p.id, name: p.name, input: p.input, parentId: p.parentId, agentType: p.agentType }) - 1;
    set({ live: { ...live, blocks, thinking: false, toolMap: { ...live.toolMap, [p.id]: idx } } });
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

  // Whole-list snapshot of the turn's subagents / background shells / workflows. REPLACE semantics
  // (the server re-sends everything on each change) so a missed event can't wedge a stale row.
  sock.on('tasks:update', (p: any) => { if (isCur(p.sessionId)) set({ tasks: p.tasks || [] }); });

  sock.on('turn:end', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const exists = get().messages.some((m) => m.id === p.message.id);
    set({
      messages: exists ? get().messages : [...get().messages, p.message],
      live: null, turnActive: false,
    });
  });

  // a naming call is running (auto after the first turn, the manual button, or an import) — the row
  // and the header wear the waiting mark until the title lands. `on:false` also covers the calls
  // that finish without a new title (fallback, or the user renamed it meanwhile).
  sock.on('session:titling', (p: { sessionId: string; on: boolean }) => {
    const rest = get().titling.filter((id) => id !== p.sessionId);
    set({ titling: p.on ? [...rest, p.sessionId] : rest });
  });

  // the server named a fresh chat after its topic — update the sidebar row + the open header
  sock.on('session:title', (p: { sessionId: string; title: string }) => {
    set({ titling: get().titling.filter((id) => id !== p.sessionId) });
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
  // the learner parked an addition for this thread ('ask' mode) — the chat shows a card
  sock.on('wiki:proposal', (p: any) => {
    if (!p?.proposal || get().current?.chatSessionId !== p.sessionId) return;
    if (get().wikiProposals.some((x) => x.id === p.proposal.id)) return;
    set({ wikiProposals: [...get().wikiProposals, p.proposal] });
  });
  // 'auto' mode wrote one straight in — say so once, without asking for anything
  sock.on('wiki:learned', (p: any) => {
    if (get().current?.chatSessionId !== p?.sessionId) return;
    set({ wikiLearned: [...get().wikiLearned, { id: `${p.topicId}:${Date.now()}`, topicName: p.topicName || '', title: p.title || '' }] });
  });
  // A file changed in the project a session watches. The same payload arrives twice for the open
  // chat (its session room + the owner's user room), so it is stored keyed by session, not appended.
  sock.on('project:changed', (p: any) => {
    if (!p?.sessionId) return;
    // `fired` belongs to THIS change, not the previous one — carrying it over made a later card
    // claim a prompt had gone out when none had. project:watchFired sets it right after.
    set({ projectChanges: { ...get().projectChanges, [p.sessionId]: { ...p, fired: false } } });
  });
  // 'prompt' mode sent its stored prompt as a turn — the card says so instead of looking idle
  sock.on('project:watchFired', (p: any) => {
    if (!p?.sessionId) return;
    const prev = get().projectChanges[p.sessionId];
    if (prev) set({ projectChanges: { ...get().projectChanges, [p.sessionId]: { ...prev, fired: true } } });
  });
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

  // ── guide assistant ──
  // Every event is per-user (the server emits to `user:<id>`), so no session filter is needed —
  // and a turn started in another tab renders here too.
  sock.on('guide:message', (p: any) => {
    if (get().guideMessages.some((m) => m.id === p.message.id)) return;
    set({ guideMessages: [...get().guideMessages, p.message] });
  });
  sock.on('guide:start', () => set({ guideLive: emptyLive(), guideBusy: true }));
  sock.on('guide:delta', (p: any) => {
    const live = get().guideLive || emptyLive();
    const blocks = live.blocks.slice();
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'text') blocks[blocks.length - 1] = { type: 'text', text: last.text + p.text };
    else blocks.push({ type: 'text', text: p.text });
    set({ guideLive: { ...live, blocks } });
  });
  sock.on('guide:tool', (p: any) => {
    const live = get().guideLive || emptyLive();
    const blocks = live.blocks.slice();
    const idx = blocks.push({ type: 'tool_use', id: p.id, name: p.name, input: p.input }) - 1;
    set({ guideLive: { ...live, blocks, toolMap: { ...live.toolMap, [p.id]: idx } } });
  });
  sock.on('guide:toolResult', (p: any) => {
    const live = get().guideLive; if (!live) return;
    const idx = live.toolMap[p.id]; if (idx == null) return;
    const blocks = live.blocks.slice();
    const b = blocks[idx];
    if (b && b.type === 'tool_use') blocks[idx] = { ...b, output: p.output, isError: p.isError };
    set({ guideLive: { ...live, blocks } });
  });
  sock.on('guide:end', (p: any) => {
    const exists = get().guideMessages.some((m) => m.id === p.message.id);
    set({
      guideMessages: exists ? get().guideMessages : [...get().guideMessages, p.message],
      guideLive: null, guideBusy: false, guideUnread: !get().guideOpen,
    });
  });
  sock.on('guide:error', (p: any) => {
    set({ guideLive: null, guideBusy: false, error: p.aborted ? null : t('common.errorPrefix', { msg: p.error }) });
  });
  sock.on('guide:cleared', () => set({ guideMessages: [], guideLive: null, guideBusy: false }));
  sock.on('guide:action', (p: any) => { void applyGuideAction(get, p?.action, p?.value ?? null); });

  // ── side chat — same shape as the guide's stream, scoped to the open thread ──
  sock.on('aside:start', (p: any) => { if (isCur(p.sessionId)) set({ asideLive: emptyLive(), asideBusy: true, asideOpen: true }); });
  sock.on('aside:delta', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const live = get().asideLive || emptyLive();
    const blocks = [...live.blocks];
    const last = blocks[blocks.length - 1];
    if (last?.type === 'text') blocks[blocks.length - 1] = { ...last, text: last.text + p.text };
    else blocks.push({ type: 'text', text: p.text });
    set({ asideLive: { ...live, blocks } });
  });
  sock.on('aside:end', (p: any) => {
    if (!isCur(p.sessionId)) return;
    const blocks: Block[] = p.blocks?.length ? p.blocks : (get().asideLive?.blocks || []);
    set({
      asideMessages: [...get().asideMessages, { id: crypto.randomUUID(), role: 'assistant', content: { blocks, interrupted: !!p.interrupted }, createdAt: Date.now() }],
      asideLive: null, asideBusy: false,
    });
  });
  sock.on('aside:error', (p: any) => {
    if (!isCur(p.sessionId)) return;
    set({ asideLive: null, asideBusy: false, error: p.aborted ? null : t('common.errorPrefix', { msg: p.error }) });
  });

  sock.on('queue:update', (p: any) => { if (isCur(p.sessionId)) set({ queue: { running: p.running, waiting: p.waiting } }); });
  sock.on('presence:update', (p: any) => { if (isCur(p.sessionId)) set({ presence: p.users }); });
  sock.on('turn:congested', (p: any) => { if (isCur(p.sessionId)) { set({ congested: true }); setTimeout(() => set({ congested: false }), 4000); } });
}
