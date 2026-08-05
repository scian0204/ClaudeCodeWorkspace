// What the guide agent is allowed to do, as ONE table.
//
// The agent never talks to the database. It calls the app's own HTTP API through `app.inject()`
// carrying the signed-in user's session cookie, so every route runs its normal requireAuth /
// requireAdmin / ownership checks. Permission enforcement is therefore *identical* to clicking the
// UI — there is no second, drifting copy of the rules. This table only narrows that surface further:
//
//   - allowlist, not denylist: anything not listed here is refused before it reaches Fastify;
//   - no DELETE at all — the agent must never destroy a chat, project, plugin or repo. It explains
//     where the delete button is instead. (ponytail: skipped a confirm-card protocol; add one only
//     if deletion by chat is actually wanted.)
//   - no credential/secret routes (Claude token, git credentials, LLM providers, admin token) —
//     those must be typed by the human into the real form, never handled by an agent;
//   - no admin *infrastructure* verbs (restart, cleanup, docker pull, user create/delete).
//
// `note` is not just a comment: it is rendered into the agent's system prompt as its API reference,
// so a route added here is a route the agent immediately knows how to use.

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

export interface ApiRoute {
  m: Method;
  path: string;    // display form, ':id' placeholders — what the prompt shows
  re: RegExp;      // matcher for the real request path (query string stripped before matching)
  note: string;    // what it does + which body fields matter (goes into the prompt)
  admin?: boolean; // admin-only route (the route itself still enforces it; this only shapes the prompt)
}

// ':id' → a path-segment matcher
const rx = (p: string) => new RegExp(`^${p.replace(/\./g, '\\.').replace(/:[a-zA-Z]+/g, '[^/]+')}$`);
const r = (m: Method, path: string, note: string, admin = false): ApiRoute =>
  ({ m, path, re: rx(path), note, admin });

export const API_ROUTES: ApiRoute[] = [
  // ── read ──
  r('GET', '/api/auth/me', 'the signed-in user: id, username, role, displayName, and the per-user toggles autoTitle / autoResume / primeWindow / hasClaudeToken.'),
  r('GET', '/api/config', 'workspace feature flags + the model dropdown list (models, defaultModel, defaultEffort, dmEnabled, searchEnabled, …).'),
  r('GET', '/api/sessions', "the user's own private chats (id, title, projectId, model, effort, updatedAt)."),
  r('GET', '/api/sessions/:id', 'one chat + its full message history.'),
  r('GET', '/api/sessions/:id/commands', 'the slash commands / skills the CLI exposes in that chat.'),
  r('GET', '/api/sessions/:id/usage', 'context-window fill + claude.ai plan limits (5h / weekly / per-model) for that chat.'),
  r('GET', '/api/rooms', 'shared rooms the user belongs to.'),
  r('GET', '/api/rooms/:id', 'one room: members + delegations + messages.'),
  r('GET', '/api/projects', 'projects: { common, mine }. A project is a working directory a chat can be pointed at.'),
  r('GET', '/api/projects/:id/git/status', 'git status of a project (branch, dirty files, origin host, resolved credential).'),
  r('GET', '/api/projects/:id/git/log', 'commit history of a project for the history graph. Query: ?limit=<n>&all=1 (all = every branch/remote/tag, not just HEAD). Each commit carries hash, short, parents, author, date, subject, refs.'),
  r('GET', '/api/projects/:id/git/diff', 'one patch from a project. Query: ?commit=<sha> (that commit, stat + patch) or ?path=<repo-relative file> (uncommitted changes vs HEAD; add &untracked=1 for a file git does not track yet).'),
  r('GET', '/api/wiki/topics', 'LLM Wiki topics with their compile status.'),
  r('GET', '/api/plugins', 'installed plugins: { common, mine, prefs }. Skills live inside plugins.'),
  r('GET', '/api/plugins/:id/detail', "one plugin's manifest + the skills it exposes (with usage counters)."),
  r('GET', '/api/marketplaces', 'registered plugin marketplaces: { common, mine }.'),
  r('GET', '/api/review/sessions', 'PR review sessions visible to the user (verdict, merge state).'),
  r('GET', '/api/review/repos', 'watched PR-review repositories.', true),
  r('GET', '/api/requests', 'member→admin requests (a member sees their own, an admin sees all).'),
  r('GET', '/api/requests/actions', 'which admin actions a member may request, and the fields each one takes.'),
  r('GET', '/api/dm/channels', 'DM + group channels the user belongs to.'),
  r('GET', '/api/users', 'workspace users (id, username, displayName, role).'),
  r('GET', '/api/search', 'workspace-wide search. Query string: ?q=<text>. Scoped to what the user may see.'),
  r('GET', '/api/brand', 'workspace title + logo.'),
  r('GET', '/api/admin/config', 'every admin setting: value, default, type, min/max, whether a restart is needed.', true),
  r('GET', '/api/admin/overview', 'admin dashboard totals (users, sessions, rooms, token/cost usage).', true),
  r('GET', '/api/admin/usage', 'per-user token + cost usage.', true),

  // ── write: the user's own things ──
  r('POST', '/api/sessions', 'create a private chat. Body: { title?, projectId? }. Returns { session }. Follow it with a ui action openSession so the user lands in it.'),
  r('PATCH', '/api/sessions/:id', 'change a chat: { title?, projectId?, model?, effort? (low|medium|high|xhigh|max), permissionMode? (default|acceptEdits|plan|bypassPermissions) }.'),
  r('POST', '/api/sessions/:id/retitle', 'name a chat from its conversation (no body).'),
  r('POST', '/api/projects', 'create a project. Body: { name?, gitUrl?, branch?, credentialId? }. With gitUrl the repository is CLONED (a private repo needs a git credential already stored for that host). Omit `scope` for a personal project; scope:"common" is admin-only — a member must file a request instead.'),
  r('POST', '/api/projects/:id/git/pull', 'pull a project working dir (no body, or { rebase: true }). Fetches every remote (--all), so branches created upstream arrive too. The current branch is fast-forward only by default — if local commits diverged it fails, and rebase:true replays them on top instead.'),
  r('POST', '/api/rooms', 'create a shared room. Body: { name }.'),
  r('POST', '/api/wiki/topics', 'create an LLM Wiki topic. Body: { name, description? }. Admin-only — a member must file a request instead.', true),
  r('POST', '/api/dm/channels', 'open a DM or group channel. Body: { kind:"dm", userId } or { kind:"group", name, memberIds }.'),
  r('PATCH', '/api/auth/me', 'the per-user toggles. Body: any of { autoTitle, autoResume, primeWindow } as booleans. primeWindow = "keep the claude.ai 5-hour window open" (5시간 선점).'),
  r('POST', '/api/requests', 'ask an admin for an admin-only action. Body: { type, payload, reason }. Valid types come from GET /api/requests/actions.'),

  // ── write: plugins / skills ──
  r('POST', '/api/plugins/install', 'install a plugin (its skills come with it) from a git URL. Body: { scope:"user"|"common", name, repo }. scope "common" is admin-only; for a member always use "user".'),
  r('POST', '/api/plugins/:id/enabled', 'enable/disable a plugin you own (or, as admin, a common one). Body: { enabled }.'),
  r('POST', '/api/plugins/:id/pref', 'your personal on/off for a COMMON plugin. Body: { enabled }.'),
  r('POST', '/api/plugins/:id/update', 'pull the latest of a git-installed plugin (no body).'),
  r('POST', '/api/marketplaces', 'register a plugin marketplace. Body: { scope:"user"|"common", name, url }.'),

  // ── write: admin ──
  r('POST', '/api/requests/:id/decide', 'approve or reject a member request. Body: { approve: boolean, note? }.', true),
  r('PUT', '/api/admin/config', 'change an admin setting. Body: { key, value }. Keys, types and limits come from GET /api/admin/config.', true),
  r('PUT', '/api/admin/brand', 'set the workspace title. Body: { title }.', true),
  r('POST', '/api/plugins/:id/forced', 'make a common plugin mandatory for everyone. Body: { forced }.', true),
  r('POST', '/api/review/repos', 'watch a repository for PR auto-review. Body: { gitUrl, credentialId, name?, baseBranch?, sandboxImage?, webhook?, pollEnabled? }.', true),
  r('PATCH', '/api/review/repos/:id', 'change a watched repo. Body: { name?, baseBranch?, sandboxImage?, credentialId?, pollEnabled? }.', true),
  r('POST', '/api/review/repos/:id/poll', 'poll a watched repo for open PRs right now (no body).', true),
  r('POST', '/api/review/sessions/:id/auto', 'run the auto-review pipeline on a PR (no body).', true),
];

// Query strings are stripped before matching so `?q=…` can't smuggle a path past the allowlist.
export function findRoute(method: string, rawPath: string): ApiRoute | null {
  const path = String(rawPath).split('?')[0].split('#')[0];
  const m = String(method).toUpperCase();
  return API_ROUTES.find((x) => x.m === m && x.re.test(path)) || null;
}

// The API reference block embedded in the agent's system prompt. Admin-only routes are dropped for
// members: unlisted = never offered, and the route would 403 anyway (belt and braces).
export function apiReference(isAdmin: boolean): string {
  return API_ROUTES.filter((x) => isAdmin || !x.admin)
    .map((x) => `- ${x.m} ${x.path}${x.admin ? ' [admin]' : ''} — ${x.note}`)
    .join('\n');
}
