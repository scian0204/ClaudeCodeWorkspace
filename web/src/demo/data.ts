// Seed data + in-memory "database" for the static GitHub Pages demo (VITE_DEMO build).
// Mutations (create/delete chat, room, wiki, plugin toggles…) persist for the tab session
// and reset on reload. Nothing here ships in the normal build — it's tree-shaken away.

const now = Date.now();
const ago = (min: number) => now - min * 60_000;

export const COLORS = { clay: '#c8613a', blue: '#5b6b8c', green: '#5b8c6b', purple: '#6b5b8c', warm: '#8c7a5b' };

// ---- users -----------------------------------------------------------------
export const ME = {
  id: 'u_admin', username: 'admin', role: 'admin', displayName: 'Demo Admin',
  avatarColor: COLORS.clay, hasClaudeToken: true, claudeTokenSetAt: ago(60 * 24 * 3) as number | null,
};
const U_JAMIE = { id: 'u_jamie', username: 'jamie', role: 'member', displayName: 'Jamie Park', avatarColor: COLORS.blue };
const U_RILEY = { id: 'u_riley', username: 'riley', role: 'member', displayName: 'Riley Kim', avatarColor: COLORS.green };
const U_SAM = { id: 'u_sam', username: 'sam', role: 'member', displayName: 'Sam Lee', avatarColor: COLORS.purple };

const member = (u: any, isOwner = false, delegations: string[] = []) => ({
  userId: u.id, displayName: u.displayName, avatarColor: u.avatarColor, username: u.username, isOwner, delegations, joinedAt: ago(500),
});

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
    tx('A refund is modeled as a **negative capture** against the original `Payment`, never a delete:\n\n1. `RefundRequested` is recorded on the `Payment` aggregate\n2. The gateway adapter issues the provider refund\n3. On the webhook, `RefundSettled` flips the ledger entry\n\nSee **refunds.md** for the state machine and the idempotency rules.'),
  ], ago(199)),
];

// ---- projects / trees / files ---------------------------------------------
export const TREE_PROJECT = [
  { name: 'src/index.ts', size: 812 }, { name: 'src/auth/middleware.ts', size: 1440 },
  { name: 'src/auth/tokenService.ts', size: 2210 }, { name: 'src/routes/admin.ts', size: 980 },
  { name: 'README.md', size: 640 }, { name: 'package.json', size: 410 },
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

// ---- plugins / marketplaces ------------------------------------------------
const plugin = (id: string, name: string, source: string, enabled: number, forced = 0, repo: string | null = null) => ({ id, name, source, enabled, forced, repo });

// ---- the mutable "db" ------------------------------------------------------
export const db = {
  me: { ...ME },
  users: [ME, U_JAMIE, U_RILEY, U_SAM].map((u) => ({ id: u.id, username: u.username, role: u.role, displayName: u.displayName, avatarColor: u.avatarColor })),
  sessions: [
    { id: 's_auth', title: 'Auth module refactor', updatedAt: ago(11), projectId: 'p_api', model: 'claude-opus-4-8', permissionMode: 'default' },
    { id: 's_socket', title: 'Socket reconnect bug', updatedAt: ago(138), projectId: 'p_web', model: 'claude-sonnet-5', permissionMode: 'acceptEdits' },
    { id: 's_notes', title: 'Release notes v2.3', updatedAt: ago(60 * 20), projectId: null, model: 'claude-opus-4-8', permissionMode: 'default' },
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
  // per-chat message history (also used by the socket sim to append turns)
  messages: {
    s_auth: AUTH_MSGS, s_socket: SOCKET_MSGS, s_notes: [],
    cs_backend: ROOM_MSGS, cs_design: [], cs_w_pay: WIKI_MSGS, cs_w_onboard: [],
  } as Record<string, any[]>,
};

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
  settings: { allowBypass: false, maxConcurrentTurns: 3, codeServer: 'codercom/code-server:latest' },
};

export const pluginDetail = (id: string) => {
  const all = [...db.plugins.common, ...db.plugins.mine];
  const p = all.find((x) => x.id === id) || db.plugins.common[0];
  const isCommon = db.plugins.common.some((x) => x.id === p.id);
  return {
    plugin: { id: p.id, name: p.name, scope: isCommon ? 'common' : 'user', source: p.source, repo: p.repo ?? null },
    manifest: { name: p.name, description: `${p.name} — packaged skills for Claude Code.`, version: '1.2.0', homepage: p.repo ?? undefined },
    skills: [
      { dir: `${p.name}/review`, name: 'review', description: 'One-line code review comments' },
      { dir: `${p.name}/summarize`, name: 'summarize', description: 'Summarize a diff or file' },
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

// helpers used by the router for mutations
export const genId = (p: string) => `${p}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
