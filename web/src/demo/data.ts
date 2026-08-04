// Seed data + in-memory "database" for the static GitHub Pages demo (VITE_DEMO build).
// Mutations (create/delete chat, room, wiki, plugin toggles…) persist for the tab session
// and reset on reload. Nothing here ships in the normal build — it's tree-shaken away.

const now = Date.now();
const ago = (min: number) => now - min * 60_000;

export const COLORS = { clay: '#c8613a', blue: '#5b6b8c', green: '#5b8c6b', purple: '#6b5b8c', warm: '#8c7a5b' };

// ---- users -----------------------------------------------------------------
export const ME = {
  id: 'u_admin', username: 'admin', role: 'admin', displayName: 'Demo Admin',
  avatarColor: COLORS.clay, avatar: null as string | null, hasClaudeToken: true, claudeTokenSetAt: ago(60 * 24 * 3) as number | null,
  autoTitle: true, autoResume: true, // demo: on so the limit-reset banner is reachable
  primeWindow: true, primedAt: ago(37) as number | null,
};
const U_JAMIE = { id: 'u_jamie', username: 'jamie', role: 'member', displayName: 'Jamie Park', avatarColor: COLORS.blue };
const U_RILEY = { id: 'u_riley', username: 'riley', role: 'member', displayName: 'Riley Kim', avatarColor: COLORS.green };
const U_SAM = { id: 'u_sam', username: 'sam', role: 'member', displayName: 'Sam Lee', avatarColor: COLORS.purple };

const member = (u: any, isOwner = false, delegations: string[] = []) => ({
  userId: u.id, displayName: u.displayName, avatarColor: u.avatarColor, username: u.username, isOwner, delegations, joinedAt: ago(500),
});
const dmMember = (u: any) => ({ userId: u.id, displayName: u.displayName, avatarColor: u.avatarColor, avatar: (u as any).avatar ?? null, username: u.username });

// ---- message builders ------------------------------------------------------
let mid = 0;
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${(mid++).toString(36)}`;
const userMsg = (author: any, text: string, at: number) => ({ id: nextId('m'), role: 'user', authorId: author.id, authorName: author.displayName, content: { text }, createdAt: at });
const claudeMsg = (blocks: any[], at: number) => ({ id: nextId('m'), role: 'assistant', authorId: null, authorName: 'Claude', content: { blocks }, createdAt: at });
const tx = (text: string) => ({ type: 'text', text });
const tool = (name: string, input: any, output: string, isError = false) => ({ type: 'tool_use', id: nextId('t'), name, input, output, isError });

// ---- seeded conversations --------------------------------------------------
const AUTH_MSGS = [
  userMsg(ME, 'Kick off the auth refactor when you get a sec.', ago(90)),
  claudeMsg([tx("Sure — I'll start by mapping the current auth flow, then propose the smallest change that moves us onto `TokenService`.")], ago(89)),
  userMsg(ME, '/clear', ago(80)),
  userMsg(ME, 'Refactor the auth middleware to use the new `TokenService`.', ago(12)),
  claudeMsg([
    tx('On it. Let me find every place the old inline check is used first.'),
    tool('Bash', { command: 'grep -rn "verifyToken(" src/' },
      'src/auth/middleware.ts:14:  const ok = verifyToken(req.headers.authorization);\nsrc/routes/admin.ts:8:  if (!verifyToken(req)) return reply.code(401);'),
    tx('Two call sites. Here is the plan:\n\n1. Route both through `TokenService.verify()`\n2. Drop the duplicated header parsing\n3. Return a typed `AuthContext`\n\n```ts\nexport async function authGuard(req: Request) {\n  const ctx = await TokenService.verify(req.headers.authorization);\n  if (!ctx) throw new Unauthorized();\n  return ctx;\n}\n```\n\nWant me to apply this across both files?'),
  ], ago(11)),
];

const SOCKET_MSGS = [
  userMsg(ME, 'The socket keeps dropping after ~30s idle. Any idea?', ago(140)),
  claudeMsg([
    tx('Classic idle timeout. Most likely the proxy is closing the connection before a ping goes out. Let me check the client config.'),
    tool('Read', { file_path: 'web/src/lib/socket.ts' }, "io({ path: '/socket.io', transports: ['websocket', 'polling'] })"),
    tx('No `pingInterval` override, so it relies on the server default. I\'d set an explicit heartbeat under the proxy idle window (e.g. 25s) and confirm the proxy `read timeout` is higher.'),
  ], ago(138)),
];

const ROOM_MSGS = [
  userMsg(U_JAMIE, 'Can we get the nightly export job idempotent? It double-wrote yesterday.', ago(55)),
  claudeMsg([
    tx('Yes — the safe fix is a unique key on `(export_date, target)` plus an upsert. That way a re-run is a no-op instead of a duplicate.'),
    tool('Edit', { file_path: 'jobs/nightly_export.py' }, 'Applied: switched INSERT to INSERT ... ON CONFLICT DO NOTHING'),
    tx('Done. I also added a guard that logs when a re-run is skipped, so we can watch it working tonight.'),
  ], ago(53)),
  userMsg(U_RILEY, 'Nice. I\'ll watch the logs at the next run.', ago(50)),
];

const WIKI_MSGS = [
  userMsg(ME, 'How does a refund flow through the payments domain?', ago(200)),
  claudeMsg([
    tx('Let me check the knowledge base first.'),
    tool('Read', { file_path: 'wiki/_index.md' }, '# Payments Domain — Index\n- overview.md\n- refunds.md\n- ledger.md'),
    tx('The refund flow lives in the refunds article — reading it, plus the overview for context.'),
    tool('Read', { file_path: 'wiki/refunds.md' }, 'A refund is a negative capture, never a delete. States: RefundRequested → RefundSettled. Idempotent by (paymentId, requestId).'),
    tool('Read', { file_path: 'wiki/overview.md' }, 'The payments domain owns captures, refunds, and the ledger. Event-sourced on the Payment aggregate.'),
    tx('Grounded in the wiki, here is the flow.\n\nA refund is modeled as a **negative capture** against the original `Payment`, never a delete:\n\n1. `RefundRequested` is recorded on the `Payment` aggregate\n2. The gateway adapter issues the provider refund\n3. On the webhook, `RefundSettled` flips the ledger entry\n\nRefunds are **idempotent** by `(paymentId, requestId)`.\n\n**Sources:** `wiki/refunds.md` (state machine + idempotency), `wiki/overview.md`. Original source: `raw/gateway-notes.md`.'),
  ], ago(199)),
];

const REVIEW_MSGS = [
  userMsg(ME, 'Merge PR #142 locally, then build and run the tests.', ago(14)),
  claudeMsg([
    tx('Merged `feat/rate-limit` into `main` cleanly. Building and running the suite now.'),
    tool('Bash', { command: 'npm ci && npm test' }, 'PASS  test/rate-limit.test.ts (12 passed)\nPASS  test/api.test.ts (34 passed)\n\nTests: 46 passed, 46 total'),
    tx('Green across the board. The limiter is a token-bucket keyed by API key. One note: the window size is read from env at import time, so a hot config change wouldn\'t take effect without a restart — minor. Otherwise this looks good to merge.'),
  ], ago(13)),
];

// ---- projects / trees / files ---------------------------------------------
export const TREE_PROJECT = [
  { name: 'src/index.ts', size: 812 }, { name: 'src/auth/middleware.ts', size: 1440 },
  { name: 'src/auth/tokenService.ts', size: 2210 }, { name: 'src/auth/session.ts', size: 1320 },
  { name: 'src/routes/admin.ts', size: 980 }, { name: 'src/routes/users.ts', size: 1160 },
  { name: 'src/routes/health.ts', size: 220 }, { name: 'src/lib/db.ts', size: 1740 },
  { name: 'src/lib/logger.ts', size: 560 }, { name: 'src/lib/config.ts', size: 640 },
  { name: 'tests/auth.test.ts', size: 1980 }, { name: 'tests/routes.test.ts', size: 1520 },
  { name: 'README.md', size: 640 }, { name: 'package.json', size: 410 }, { name: 'tsconfig.json', size: 320 },
];
export const TREE_PLUGIN = [
  { name: 'plugin.json', size: 210 }, { name: 'skills/review/SKILL.md', size: 1180 },
  { name: 'skills/summarize/SKILL.md', size: 940 }, { name: 'README.md', size: 720 },
];
const FILE_CONTENT: Record<string, string> = {
  'README.md': '# api-server\n\nInternal API. See `src/` for routes.\n\n```bash\nnpm run dev\n```',
  'src/auth/middleware.ts': "import { TokenService } from './tokenService';\n\nexport async function authGuard(req) {\n  const ctx = await TokenService.verify(req.headers.authorization);\n  if (!ctx) throw new Unauthorized();\n  return ctx;\n}",
  'src/auth/tokenService.ts': 'export class TokenService {\n  static async verify(header?: string) {\n    // …validates the bearer token, returns an AuthContext or null\n  }\n}',
  'plugin.json': '{\n  "name": "code-review",\n  "version": "1.2.0",\n  "description": "One-line PR review comments"\n}',
  'skills/review/SKILL.md': '---\nname: review\ndescription: One-line code review comments\n---\n\nReview the diff and return one comment per finding.',
};
export const fileContent = (path: string) => FILE_CONTENT[path]
  ?? `// ${path}\n// (demo file — content is illustrative)\nexport default {};\n`;

// ---- wiki content ----------------------------------------------------------
export const WIKI_ARTICLES = [
  { name: '_index.md', content: '# Payments Domain — Index\n\nEntry point for the compiled knowledge base.\n\n- [[overview]] — what the domain owns\n- [[refunds]] — refund state machine + idempotency\n- [[ledger]] — double-entry source of truth' },
  { name: 'overview.md', content: '# Payments Domain\n\nThe payments domain owns money movement: **captures**, **refunds**, and the **ledger**. Everything is event-sourced on the `Payment` aggregate.' },
  { name: 'refunds.md', content: '# Refunds\n\nA refund is a *negative capture*, never a delete.\n\n| State | Trigger |\n|---|---|\n| RefundRequested | user/admin action |\n| RefundSettled | provider webhook |\n\nRefunds are **idempotent** by `(paymentId, requestId)`.' },
  { name: 'ledger.md', content: '# Ledger\n\nDouble-entry. Every capture/refund writes two rows. The ledger is the source of truth for reporting — not the gateway.' },
];
export const WIKI_RAW = [
  { name: 'raw/billing-spec.pdf', size: 40320 }, { name: 'raw/gateway-notes.md', size: 2210 }, { name: 'raw/ledger.sql', size: 1180 },
];
export const WIKI_TREE_ARTICLES = WIKI_ARTICLES.map((a) => ({ name: a.name, size: a.content.length }));
export const wikiFileContent = (dir: string, path: string) => {
  if (dir === 'wiki') return WIKI_ARTICLES.find((a) => a.name === path)?.content ?? `# ${path}`;
  return `# ${path}\n\n(raw source document — illustrative content for the demo)`;
};

// ---- slash commands (the "/" palette) --------------------------------------
export const COMMANDS = [
  { name: 'clear', description: 'Clear the conversation history', argumentHint: '' },
  { name: 'compact', description: 'Compact the conversation to save context', argumentHint: '[instructions]' },
  { name: 'review', description: 'Review a pull request', argumentHint: '[PR number]' },
  { name: 'security-review', description: 'Security review of the current changes', argumentHint: '' },
  { name: 'init', description: 'Initialize a CLAUDE.md for this project', argumentHint: '' },
  { name: 'test', description: 'Run the test suite and summarize failures', argumentHint: '[path]' },
];

// ---- session usage (context window + plan rate limits) ---------------------
// Matches the /api/sessions/:id/usage shape; reset timestamps are relative to now so the popover
// shows live "resets in Xh Ym" countdowns in the static demo.
const inMin = (m: number) => new Date(Date.now() + m * 60000).toISOString();
export const USAGE = {
  context: { totalTokens: 41900, maxTokens: 1_000_000, percentage: 4, model: 'claude-opus-4-8' },
  rateLimitsAvailable: true,
  subscriptionType: 'team',
  rateLimits: {
    fiveHour: { utilization: 2, resetsAt: inMin(4 * 60 + 18) },
    sevenDay: { utilization: 59, resetsAt: inMin(18 * 60 + 28) },
    modelScoped: [{ displayName: 'Fable', utilization: 0, resetsAt: inMin(18 * 60 + 28) }],
  },
};

// ---- plugins / marketplaces ------------------------------------------------
const plugin = (id: string, name: string, source: string, enabled: number, forced = 0, repo: string | null = null) => ({ id, name, source, enabled, forced, repo });

// ---- the mutable "db" ------------------------------------------------------
export const db = {
  me: { ...ME },
  users: [ME, U_JAMIE, U_RILEY, U_SAM].map((u) => ({ id: u.id, username: u.username, role: u.role, displayName: u.displayName, avatarColor: u.avatarColor })),
  sessions: [
    { id: 's_auth', title: 'Auth module refactor', updatedAt: ago(11), projectId: 'p_api', model: 'claude-opus-4-8', effort: 'high', permissionMode: 'default' },
    { id: 's_socket', title: 'Socket reconnect bug', updatedAt: ago(138), projectId: 'p_web', model: 'claude-sonnet-5', effort: 'medium', permissionMode: 'acceptEdits' },
    { id: 's_infra', title: 'Terraform drift check', updatedAt: ago(300), projectId: 'p_shared', model: 'claude-sonnet-5', effort: 'high', permissionMode: 'default' },
    { id: 's_notes', title: 'Release notes v2.3', updatedAt: ago(60 * 20), projectId: null, model: 'claude-opus-4-8', effort: 'high', permissionMode: 'default' },
  ],
  rooms: [
    { id: 'r_backend', name: 'Backend Guild', ownerId: U_JAMIE.id, chatSessionId: 'cs_backend', permissionMode: 'default', members: [member(U_JAMIE, true), member(ME, false, ['approve', 'interrupt']), member(U_RILEY)] },
    { id: 'r_design', name: 'Design Review', ownerId: ME.id, chatSessionId: 'cs_design', permissionMode: 'plan', members: [member(ME, true), member(U_SAM, false, ['approve'])] },
  ],
  wikiTopics: [
    { id: 'w_pay', name: 'Payments Domain', description: 'How captures, refunds and the ledger work', path: 'payments', createdBy: ME.id, createdAt: ago(60 * 24 * 5), compileStatus: 'done', compiledAt: ago(60 * 24 * 3), compileError: null },
    { id: 'w_onboard', name: 'Onboarding Guide', description: 'New engineer setup + team conventions', path: 'onboarding', createdBy: ME.id, createdAt: ago(60 * 24 * 12), compileStatus: 'done', compiledAt: ago(60 * 24 * 10), compileError: null },
  ],
  projects: {
    common: [{ id: 'p_shared', scope: 'common', ownerId: null, name: 'shared-infra', path: '/workspace/shared/infra' }] as any[],
    mine: [
      { id: 'p_api', scope: 'user', ownerId: ME.id, name: 'api-server', path: '/workspace/u_admin/api-server' },
      { id: 'p_web', scope: 'user', ownerId: ME.id, name: 'web-client', path: '/workspace/u_admin/web-client' },
    ] as any[],
  },
  roomProjects: { r_backend: [{ id: 'p_room_b', scope: 'room', ownerId: null, name: 'export-jobs', path: '/workspace/rooms/r_backend/export-jobs' }], r_design: [] } as Record<string, any[]>,
  plugins: {
    common: [plugin('pl_review', 'code-review', 'marketplace', 1, 1, 'https://github.com/anthropics/claude-code-review'), plugin('pl_ecc', 'ecc-toolkit', 'marketplace', 1, 0, 'https://github.com/example/ecc')],
    mine: [plugin('pl_caveman', 'caveman', 'local', 1, 0)],
    prefs: [] as any[],
  },
  marketplaces: { common: [{ name: 'anthropic' }, { name: 'community' }], mine: [] as any[] },
  reviewRepos: [
    { id: 'rr_web', name: 'acme/webapp', provider: 'github', host: 'github.com', slug: 'acme/webapp', gitUrl: 'https://github.com/acme/webapp.git', baseBranch: 'main', sandboxImage: null, polledAt: ago(2), pollError: null, openCount: 2, createdAt: ago(600) },
  ] as any[],
  reviewSessions: [
    { id: 'rv_142', chatSessionId: 'cs_rv_142', repoId: 'rr_web', repoName: 'acme/webapp', prNumber: 142, prTitle: 'Add rate limiting to the API', prUrl: 'https://github.com/acme/webapp/pull/142', prState: 'open', authorLogin: 'jamie', mergeState: 'merged', verdict: 'merge_safe', verdictSummary: '테스트 46개 통과, 회귀 없음. 병합 가능.', readOnly: false, updatedAt: ago(13) },
    { id: 'rv_139', chatSessionId: 'cs_rv_139', repoId: 'rr_web', repoName: 'acme/webapp', prNumber: 139, prTitle: 'Fix flaky nightly export test', prUrl: 'https://github.com/acme/webapp/pull/139', prState: 'open', authorLogin: 'riley', mergeState: 'none', verdict: 'none', verdictSummary: null, readOnly: false, updatedAt: ago(120) },
  ] as any[],
  // DM + group chat channels (lightweight human messaging — no Claude)
  dmChannels: [
    { id: 'dm_jamie', kind: 'dm', name: null, createdBy: ME.id, createdAt: ago(400),
      members: [dmMember(ME), dmMember(U_JAMIE)],
      lastMessage: { text: '스탠드업 5분 늦어요 🙏', createdAt: ago(8), userId: U_JAMIE.id }, unread: 1 },
    { id: 'dm_lunch', kind: 'group', name: '점심 모임', createdBy: ME.id, createdAt: ago(600),
      members: [dmMember(ME), dmMember(U_JAMIE), dmMember(U_RILEY)],
      lastMessage: { text: '12시 로비에서 봐요', createdAt: ago(40), userId: U_RILEY.id }, unread: 0 },
  ] as any[],
  dmMessages: {
    dm_jamie: [
      { id: 'dmm1', channelId: 'dm_jamie', userId: ME.id, text: '어제 배포 잘 됐나요?', createdAt: ago(30) },
      { id: 'dmm2', channelId: 'dm_jamie', userId: U_JAMIE.id, text: '네 문제 없었어요! 로그도 깨끗합니다.', createdAt: ago(28) },
      { id: 'dmm3', channelId: 'dm_jamie', userId: U_JAMIE.id, text: '스탠드업 5분 늦어요 🙏', createdAt: ago(8) },
    ],
    dm_lunch: [
      { id: 'dml1', channelId: 'dm_lunch', userId: ME.id, text: '오늘 점심 뭐 먹을까요?', createdAt: ago(60) },
      { id: 'dml2', channelId: 'dm_lunch', userId: U_JAMIE.id, text: '국밥 콜?', createdAt: ago(55) },
      { id: 'dml3', channelId: 'dm_lunch', userId: U_RILEY.id, text: '12시 로비에서 봐요', createdAt: ago(40) },
    ],
  } as Record<string, any[]>,
  // member request → admin approval queue (approval workflow demo)
  requests: [
    { id: 'req_1', requesterId: U_JAMIE.id, type: 'common_project', payload: JSON.stringify({ name: 'shared-tools', gitUrl: 'https://github.com/acme/shared-tools.git', branch: 'main' }), reason: '팀 공용 스크립트 저장소가 필요합니다', status: 'pending', reviewerId: null, decidedAt: null, result: null, createdAt: ago(30), updatedAt: ago(30) },
    { id: 'req_2', requesterId: U_RILEY.id, type: 'role_upgrade', payload: '{}', reason: '리뷰 담당이라 관리자 권한이 필요해요', status: 'approved', reviewerId: ME.id, decidedAt: ago(200), result: 'riley 권한을 admin으로 승격', createdAt: ago(300), updatedAt: ago(200) },
  ] as any[],
  // per-chat message history (also used by the socket sim to append turns)
  messages: {
    s_auth: AUTH_MSGS, s_socket: SOCKET_MSGS, s_notes: [],
    cs_backend: ROOM_MSGS, cs_design: [], cs_w_pay: WIKI_MSGS, cs_w_onboard: [],
    cs_rv_142: REVIEW_MSGS, cs_rv_139: [],
  } as Record<string, any[]>,
};

// LLM provider override (demo): per-scope status (type + non-secret fields; booleans for secrets).
// Seeded with a user-scope custom (LiteLLM proxy) profile so the My Page section shows a configured
// state; the common scope starts empty. Mutated in place by the router's PUT/DELETE handlers.
export const PROVIDERS: Record<'user' | 'common', any> = {
  user: {
    type: 'custom',
    fields: {
      baseUrl: 'http://litellm:4000', region: '', projectId: '', model: 'gpt-4o',
      hasAuthToken: true, hasApiKey: false, hasAccessKeyId: false, hasSecretKey: false, hasSessionToken: false, hasBearerToken: false,
    },
  },
  common: null,
};

// prompt attachments (demo): server-assigned name → { url: data URL, isImage }. Populated by the XHR
// upload interceptor (install.ts), read back by the socket mock so image thumbnails render inline.
export const ATTACHMENTS = new Map<string, { url: string; isImage: boolean }>();

export const ADMIN = {
  overview: () => ({
    users: db.users.length, rooms: db.rooms.length, sessions: db.sessions.length,
    throttle: { inUse: 1, max: 3, waiting: 0 },
    forceMock: true,
    commonToken: { hasToken: true, setAt: ago(60 * 24 * 20) },
  }),
  usage: {
    totals: { turns: 128, inputTokens: 842_000, outputTokens: 210_500, costUsd: 12.8342 },
    byUser: [
      { userId: ME.id, name: 'Demo Admin', turns: 64, inputTokens: 421_000, outputTokens: 108_200, costUsd: 6.51 },
      { userId: U_JAMIE.id, name: 'Jamie Park', turns: 38, inputTokens: 252_600, outputTokens: 61_800, costUsd: 3.94 },
      { userId: U_RILEY.id, name: 'Riley Kim', turns: 26, inputTokens: 168_400, outputTokens: 40_500, costUsd: 2.38 },
    ],
  },
  settings: { allowBypass: false },
  // resource cleanup: a plausible inventory + an in-place mutator so the demo actions actually clear
  // the counts they target (matches the server's scan → action → rescan shape).
  cleanup: {
    enabled: true,
    dockerUnavailable: false,
    containers: [
      { id: 'a1b2c3d4e5f6', name: 'ccw-cs-u_demo-p_web', state: 'running', kind: 'editor', createdAt: ago(30), orphan: false },
      { id: 'f6e5d4c3b2a1', name: 'ccw-cs-u_ghost-p_old', state: 'exited', kind: 'editor', createdAt: ago(4000), orphan: true },
      { id: '0099aabbccdd', name: 'ccw-rvsbx-rr_web-142', state: 'running', kind: 'sandbox', createdAt: ago(12), orphan: false },
    ] as any[],
    images: [
      { ref: 'codercom/code-server:latest', present: true, size: 512_000_000 },
      { ref: 'node:20-bookworm', present: true, size: 402_000_000 },
    ] as any[],
    danglingImages: { count: 3, size: 268_000_000 },
    orphanDirs: {
      reviewDirs: { count: 1, size: 84_000_000 },
      attachmentDirs: { count: 2, size: 1_500_000 },
      homeDirs: { count: 0, size: 0 },
    },
    orphanRows: { messages: 12, reviewSessions: 1, roomMembers: 0, usage: 4, pluginPrefs: 2, skillUsage: 3 },
  },
  runCleanup(action: string) {
    const c = ADMIN.cleanup;
    const editors = () => { const n = c.containers.filter((x: any) => x.kind === 'editor').length; c.containers = c.containers.filter((x: any) => x.kind !== 'editor'); return n; };
    const sandboxes = () => { const n = c.containers.filter((x: any) => x.kind === 'sandbox').length; c.containers = c.containers.filter((x: any) => x.kind !== 'sandbox'); return n; };
    const dangling = () => { const n = c.danglingImages.count; c.danglingImages = { count: 0, size: 0 }; return n; };
    const dirs = () => { const n = c.orphanDirs.reviewDirs.count + c.orphanDirs.attachmentDirs.count; c.orphanDirs.reviewDirs = { count: 0, size: 0 }; c.orphanDirs.attachmentDirs = { count: 0, size: 0 }; return n; };
    const rows = () => { const r = c.orphanRows; const n = r.messages + r.reviewSessions + r.roomMembers + r.usage + r.pluginPrefs + r.skillUsage; c.orphanRows = { messages: 0, reviewSessions: 0, roomMembers: 0, usage: 0, pluginPrefs: 0, skillUsage: 0 }; return n; };
    let summary: any = { removed: 0 };
    if (action === 'editors') summary = { removed: editors() };
    else if (action === 'sandboxes') summary = { removed: sandboxes() };
    else if (action === 'dangling-images') summary = { removed: dangling() };
    else if (action === 'orphan-dirs') summary = { removed: dirs() };
    else if (action === 'orphan-rows') summary = { removed: rows() };
    else if (action === 'full-reset') summary = { editors: { removed: editors() }, sandboxes: { removed: sandboxes() }, danglingImages: { removed: dangling() }, orphanDirs: { removed: dirs() }, orphanRows: { removed: rows() } };
    return { summary, ...c }; // c already carries enabled: true
  },
  // live activity / processes: a fake running set + in-place mutator so the demo control buttons
  // actually clear the row they target (matches the server's list → control → relist shape).
  processes: {
    dockerUnavailable: false,
    turns: [{ sessionId: 's_demo1', title: 'Refactor auth middleware', kind: 'private', author: { id: 'u_demo', name: 'Demo' }, startedAt: ago(1), elapsedMs: 60_000 }] as any[],
    queued: [{ sessionId: 's_demo1', itemId: 'q1', author: { id: 'u_two', name: 'Riya' } }] as any[],
    editors: [{ id: 'a1b2c3d4e5f6', name: 'ccw-cs-u_demo-p_web', owner: 'Demo', project: 'web', state: 'running', createdAt: ago(30) }] as any[],
    sandboxes: [{ id: '0099aabbccdd', name: 'ccw-rvsbx-rr_web-142', state: 'running', createdAt: ago(12) }] as any[],
    reviewPipelines: [{ reviewId: 'rv1', prNumber: 142, prTitle: 'Add rate limiter', repoName: 'web', chatSessionId: 's_rev1' }] as any[],
  },
  runProcess(body: any) {
    const p = ADMIN.processes;
    if (body.kind === 'turn') p.turns = p.turns.filter((x: any) => x.sessionId !== body.sessionId);
    else if (body.kind === 'queued') p.queued = p.queued.filter((x: any) => x.itemId !== body.itemId);
    else if (body.kind === 'editor') p.editors = p.editors.filter((x: any) => x.id !== body.id);
    else if (body.kind === 'sandbox') p.sandboxes = p.sandboxes.filter((x: any) => x.id !== body.id);
    else if (body.kind === 'pipeline') p.reviewPipelines = p.reviewPipelines.filter((x: any) => x.chatSessionId !== body.chatSessionId);
    return p;
  },
  // client-facing config subset (model dropdown)
  models: { 'claude-opus-4-8': 'Opus 4.8', 'claude-sonnet-5': 'Sonnet 5', 'claude-haiku-4-5-20251001': 'Haiku 4.5' } as Record<string, string>,
  // what a live /v1/models fetch answers with (newest first) — the demo's stand-in for the endpoint
  fetchedModels: {
    'claude-opus-5': 'Opus 5', 'claude-fable-5': 'Fable 5', 'claude-sonnet-5': 'Sonnet 5',
    'claude-opus-4-8': 'Opus 4.8', 'claude-haiku-4-5-20251001': 'Haiku 4.5',
  } as Record<string, string>,
  defaultModel: 'claude-opus-4-8',
  defaultEffort: 'high',
  images: { 'node:20-bookworm': { present: true, size: 402_000_000 }, 'codercom/code-server:latest': { present: false } } as Record<string, any>,
  // full config registry (representative subset for the demo)
  config: [
    { key: 'defaultModel', group: 'claude', type: 'select', options: ['claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-fable-5'], value: 'claude-opus-4-8', default: 'claude-opus-4-8', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'defaultEffort', group: 'claude', type: 'select', options: ['low', 'medium', 'high', 'xhigh', 'max'], value: 'high', default: 'high', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'models', group: 'claude', type: 'json', value: '{"claude-opus-4-8":"Opus 4.8","claude-sonnet-5":"Sonnet 5","claude-haiku-4-5-20251001":"Haiku 4.5"}', default: '{"claude-opus-4-8":"Opus 4.8"}', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'modelsAutoFetch', group: 'claude', type: 'bool', value: '1', default: '1', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'modelsRefreshMs', group: 'claude', type: 'int', value: '86400000', default: '86400000', min: 60000, max: 2592000000, unit: 'ms', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'modelsMax', group: 'claude', type: 'int', value: '8', default: '8', min: 1, max: 100, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'modelsFetchTimeoutMs', group: 'claude', type: 'int', value: '10000', default: '10000', min: 1000, max: 120000, unit: 'ms', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'forceMock', group: 'claude', type: 'bool', value: '1', default: '0', restart: false, readonly: false, secret: false, overridden: true },
    { key: 'maxConcurrentTurns', group: 'claude', type: 'int', value: '3', default: '3', min: 1, max: 100, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'autoTitleEnabled', group: 'claude', type: 'bool', value: '1', default: '1', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'autoResumeEnabled', group: 'claude', type: 'bool', value: '1', default: '1', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'windowPrimerEnabled', group: 'claude', type: 'bool', value: '1', default: '1', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'windowPrimerModel', group: 'claude', type: 'string', value: 'claude-haiku-4-5-20251001', default: 'claude-haiku-4-5-20251001', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'windowPrimerPrompt', group: 'claude', type: 'string', value: 'Reply with exactly: ok', default: 'Reply with exactly: ok', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'autoResumeGraceMs', group: 'claude', type: 'int', value: '60000', default: '60000', min: 0, max: 3600000, unit: 'ms', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'autoResumeMaxAttempts', group: 'claude', type: 'int', value: '3', default: '3', min: 1, max: 10, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'autoTitleModel', group: 'claude', type: 'string', value: 'claude-haiku-4-5-20251001', default: 'claude-haiku-4-5-20251001', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'autoTitleMaxChars', group: 'claude', type: 'int', value: '40', default: '40', min: 10, max: 120, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'importAutoTitleEnabled', group: 'claude', type: 'bool', value: '1', default: '1', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'gitPublishEnabled', group: 'git', type: 'bool', value: '1', default: '1', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'gitInitBranch', group: 'git', type: 'string', value: 'main', default: 'main', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'importAutoTitleMessages', group: 'claude', type: 'int', value: '6', default: '6', min: 1, max: 30, restart: false, readonly: false, secret: false, overridden: false },
    ...['blockNonessentialTraffic', 'privacyTelemetry', 'privacyErrorReports', 'privacyFeedbackCommands',
        'privacyFeedbackSurvey', 'privacyNonEssentialModelCalls', 'privacyAutoUpdater',
        'privacyWebFetchPreflight', 'privacyArtifact', 'privacyMarketplace'].map((key) => ({
      key, group: 'privacy', type: 'bool', value: '1', default: '1',
      restart: false, readonly: false, secret: false, overridden: false,
      // every channel is overridden by the master switch → locked in the UI while it is on
      ...(key === 'blockNonessentialTraffic' ? {} : { disabledWhen: 'blockNonessentialTraffic' }),
    })),
    { key: 'reviewAuto', group: 'review', type: 'bool', value: '1', default: '1', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'reviewPollMs', group: 'review', type: 'int', value: '60000', default: '60000', unit: 'ms', min: 0, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'reviewTurnTimeoutMs', group: 'review', type: 'int', value: '1800000', default: '1800000', unit: 'ms', min: 60000, max: 7200000, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'reviewMaxRetries', group: 'review', type: 'int', value: '2', default: '2', min: 0, max: 10, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'reviewSandboxImage', group: 'review', type: 'string', value: 'node:20-bookworm', default: 'node:20-bookworm', restart: false, readonly: false, secret: false, overridden: false, image: true },
    { key: 'gitOpTimeoutMs', group: 'git', type: 'int', value: '120000', default: '120000', unit: 'ms', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'codeServerImage', group: 'codeserver', type: 'string', value: 'codercom/code-server:latest', default: 'codercom/code-server:latest', restart: false, readonly: false, secret: false, overridden: false, image: true },
    { key: 'codeServerIdleMs', group: 'codeserver', type: 'int', value: '1800000', default: '1800000', unit: 'ms', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'attachmentMaxMB', group: 'features', type: 'int', value: '20', default: '20', unit: 'MB', min: 1, max: 200, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'attachmentMaxCount', group: 'features', type: 'int', value: '10', default: '10', min: 1, max: 50, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'resourceCleanupEnabled', group: 'features', type: 'bool', value: '1', default: '1', restart: false, readonly: false, secret: false, overridden: false },
    { key: 'sessionTtlDays', group: 'auth', type: 'int', value: '30', default: '30', unit: 'days', min: 1, max: 365, restart: false, readonly: false, secret: false, overridden: false },
    { key: 'httpBodyLimitMB', group: 'server', type: 'int', value: '6', default: '6', unit: 'MB', restart: true, readonly: false, secret: false, overridden: false },
    { key: 'port', group: 'infra', type: 'int', value: '3000', default: '3000', restart: true, readonly: true, secret: false, overridden: false },
    { key: 'dataDir', group: 'infra', type: 'string', value: '/data', default: './data', restart: true, readonly: true, secret: false, overridden: false },
    { key: 'sessionSecret', group: 'secret', type: 'string', default: 'change-me-please', restart: true, readonly: true, secret: true, set: true },
    { key: 'tokenEncSecret', group: 'secret', type: 'string', default: '', restart: true, readonly: true, secret: true, set: false },
  ] as any[],
};

// ---- git credentials + a dirty repo (for the commit/push demo) ----------------
export const GIT = {
  creds: {
    mine: [{ id: 'gc_gh', scope: 'user', provider: 'github', host: 'github.com', username: 'x-access-token', authorEmail: 'demo@ccw.local', setAt: ago(60 * 24 * 4) }],
    common: [{ id: 'gc_gl', scope: 'common', provider: 'gitlab', host: 'gitlab.com', username: 'oauth2', authorEmail: null, setAt: ago(60 * 24 * 15) }],
  } as Record<string, any[]>,
  ahead: 1, behind: 0,
  files: [
    { path: 'src/auth/middleware.ts', index: 'M', work: ' ', staged: true },
    { path: 'src/auth/tokenService.ts', index: ' ', work: 'M', staged: false },
    { path: 'src/routes/login.ts', index: '?', work: '?', staged: false },
  ] as any[],
  branches: {
    current: 'main',
    local: ['main', 'feat/auth-refactor'],
    remote: ['origin/main', 'origin/feat/auth-refactor', 'origin/release/2.3'],
  },
  // projects that are plain directories, not repos yet — what an imported project looks like, so
  // the Git panel's init / publish form is reachable in the demo. init or publish clears the flag.
  untracked: ['p_web'] as string[],
  remotes: [{ name: 'origin', url: 'https://github.com/acme/webapp.git' }] as { name: string; url: string }[],
  status(projectId?: string) {
    if (projectId && this.untracked.includes(projectId)) {
      return { repo: false, branch: '', upstream: false, ahead: 0, behind: 0, files: [], clean: true,
        host: null, hasCredential: false, credential: null,
        identity: { name: 'Demo User', email: 'demo@ccw.local' } };
    }
    return { repo: true, branch: this.branches.current, upstream: true, ahead: this.ahead, behind: this.behind,
      files: this.files, clean: this.files.length === 0, host: 'github.com', hasCredential: true,
      credential: { scope: 'user', provider: 'github', host: 'github.com', username: 'x-access-token', authorEmail: 'demo@ccw.local' },
      identity: { name: 'Demo User', email: 'demo@ccw.local' } };
  },
};

// Per-skill invocation counters, same shape the server attaches in withSkillUsage(). The demo user
// is an admin, so the per-user breakdown rides along too (a member would only get total + mine).
const skillUses = (seed: number) => {
  const byUser = [
    { userId: ME.id, name: ME.displayName, count: 5 + seed * 2 },
    { userId: U_JAMIE.id, name: U_JAMIE.displayName, count: 3 + seed },
    { userId: U_RILEY.id, name: U_RILEY.displayName, count: seed },
  ].filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  return {
    total: byUser.reduce((n, r) => n + r.count, 0),
    mine: byUser.find((r) => r.userId === ME.id)?.count || 0,
    byUser,
  };
};

export const pluginDetail = (id: string) => {
  const all = [...db.plugins.common, ...db.plugins.mine];
  const p = all.find((x) => x.id === id) || db.plugins.common[0];
  const isCommon = db.plugins.common.some((x) => x.id === p.id);
  return {
    plugin: { id: p.id, name: p.name, scope: isCommon ? 'common' : 'user', source: p.source, repo: p.repo ?? null },
    manifest: { name: p.name, description: `${p.name} — packaged skills for Claude Code.`, version: '1.2.0', homepage: p.repo ?? undefined },
    skills: [
      { dir: `${p.name}/review`, name: 'review', description: 'One-line code review comments', ...skillUses(p.name.length % 4) },
      { dir: `${p.name}/summarize`, name: 'summarize', description: 'Summarize a diff or file', ...skillUses(0) },
    ],
  };
};

// A self-contained dark "editor" placeholder shown in the split / editor view (no code-server here).
export const EDITOR_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(
  `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#1e1e1e;color:#bbb;font:14px ui-sans-serif,system-ui">
   <div style="text-align:center;max-width:420px;padding:24px">
     <div style="font-size:40px">🧑‍💻</div>
     <div style="margin:12px 0 6px;color:#e6e6e6;font-weight:600">VS Code (code-server)</div>
     <div style="font-size:12px;color:#8a8a8a;line-height:1.6">In the full app this pane is a live code-server container — editor, terminal and git in the browser. It needs a backend, so the static demo shows this placeholder.</div>
   </div></body>`);

// requestable admin actions (mirrors the server registry projection from /api/requests/actions)
// What the local-session import finds in an uploaded ~/.claude folder. Two of them are flagged
// `dup` so the picker's duplicate badge + overwrite/clone select are reachable in the demo.
export const IMPORT_SESSIONS = [
  { uuid: 'a1b2c3d4-1111-4aaa-9000-000000000001', title: 'Auth module refactor', custom: false, dup: true, mtime: Date.now() - 3 * 3600_000, msgCount: 42 },
  { uuid: 'a1b2c3d4-2222-4aaa-9000-000000000002', title: '릴리스 노트 초안', custom: true, dup: false, mtime: Date.now() - 26 * 3600_000, msgCount: 18 },
  { uuid: 'a1b2c3d4-3333-4aaa-9000-000000000003', title: 'Socket reconnect bug', custom: false, dup: true, mtime: Date.now() - 50 * 3600_000, msgCount: 77 },
  { uuid: 'a1b2c3d4-4444-4aaa-9000-000000000004', title: 'docker compose 정리', custom: false, dup: false, mtime: Date.now() - 96 * 3600_000, msgCount: 9 },
];

export const REQUEST_ACTIONS = [
  // common_project carries the real create-feature fields (name + git clone URL + branch + credential ref)
  { type: 'common_project', label: 'common_project', fields: [
    { key: 'name', type: 'text', required: true },
    { key: 'gitUrl', type: 'text', required: false },
    { key: 'branch', type: 'text', required: false },
    { key: 'credentialId', type: 'text', required: false },
  ] },
  { type: 'wiki_topic', label: 'wiki_topic', fields: [{ key: 'name', type: 'text', required: true }, { key: 'description', type: 'textarea', required: false }] },
  { type: 'role_upgrade', label: 'role_upgrade', fields: [] as any[] },
];

// helpers used by the router for mutations
export const genId = (p: string) => `${p}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
