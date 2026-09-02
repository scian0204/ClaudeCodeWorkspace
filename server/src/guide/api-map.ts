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
//   - no admin *infrastructure* verbs (restart, cleanup, docker pull, image pull, update apply,
//     backup/restore, user create/delete);
//   - no outward-facing one-way doors: merging a PR on the remote, publishing a new repository to
//     GitHub/GitLab/Bitbucket, rotating a webhook secret, transferring room ownership. `git push` is
//     the one exception, because it is the ordinary end of a commit the user just asked for — the
//     prompt makes the agent say what it is about to push and wait for a yes;
//   - no multipart uploads (attachments, plugin zips, wiki sources, logos, restore archives): the
//     agent has no file to send, so those stay a human drag-and-drop.
//
// Everything else the product can do IS meant to be here — the guide is supposed to cover the whole
// workspace, not a starter subset. When a feature lands, add its routes (rule 12 in CLAUDE.md).
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
  r('GET', '/api/projects/:id/git/branches', 'branches of a project (local + remote, current one flagged). Remote refs are fetched first, so branches made upstream show up.'),
  r('GET', '/api/projects/:id/git/remotes', 'the remotes of a project (name + url).'),
  r('GET', '/api/projects/:id/watch', "whether this project's file watch is actually running: { enabled, scope, watching, since, error }. The switch itself is per chat (PATCH /api/sessions/:id watchMode)."),
  r('GET', '/api/projects/room/:roomId', 'the projects a shared room may be pointed at.'),
  r('GET', '/api/projects/:id/tree', 'one folder of a project (?path=<relative>); ?flat=1 gives the whole tree as a flat file list. Paths + sizes, no content.'),
  r('GET', '/api/projects/:id/file', 'one file of a project as text. Query: ?path=<project-relative path>. Big or binary files come back as a placeholder.'),
  r('GET', '/api/wiki/topics', 'LLM Wiki topics with their compile status and autoLearn mode (off|ask|auto).'),
  r('GET', '/api/wiki/proposals', 'knowledge a conversation offered to a wiki and nobody has decided on yet. Query: ?sessionId=<chat id>.'),
  r('GET', '/api/wiki/topics/:id/files', "a topic's compiled wiki documents (or its raw sources when nothing is compiled yet) + compile status and the source list."),
  r('GET', '/api/wiki/topics/:id/tree', 'the file tree of a topic (wiki/ and raw/), paths + sizes.'),
  r('GET', '/api/wiki/topics/:id/graph', "the link graph of a topic's compiled articles: nodes (one per article, with its link count) and edges (one per cross-link). Read out of the articles themselves, so it changes with each recompile."),
  r('GET', '/api/wiki/topics/:id/paths', 'every file in a topic as two flat lists (wiki/ and raw/), names only.'),
  r('GET', '/api/wiki/topics/:id/file', 'one file of a topic as text. Query: ?path=<relative path>.'),
  r('GET', '/api/agents', 'team agents the user can see: { common, mine, project, files }. `files` are read-only .claude/agents/*.md found on disk.'),
  r('GET', '/api/pools', 'shared-plan pools (토큰 모아쓰기): { pools, allUsers, myPoolId, optedOut, hasCredential, canCreate }. All empty when an admin has the feature off.'),
  r('GET', '/api/plugins', 'installed plugins: { common, mine, projects, prefs }. `projects` are per-project installs (each row carries projectId) that apply to every chat pointed at that project. Skills live inside plugins.'),
  r('GET', '/api/plugins/:id/detail', "one plugin's manifest + the skills it exposes (with usage counters)."),
  r('GET', '/api/plugins/:id/tree', 'the file tree of an installed plugin — use it to see what a skill actually contains.'),
  r('GET', '/api/plugins/:id/file', 'one file of an installed plugin as text. Query: ?path=<relative path>.'),
  r('GET', '/api/marketplaces', 'registered plugin marketplaces: { common, mine }.'),
  r('GET', '/api/marketplaces/:id/plugins', 'what a marketplace offers: { name, description, plugins:[{ name, description }] } read from its .claude-plugin/marketplace.json. Add ?refresh=1 to pull the repo first.'),
  r('GET', '/api/review/sessions', 'PR review sessions visible to the user (verdict, merge state).'),
  r('GET', '/api/review/sessions/:id', 'one PR review: the PR (number, title, url, branches), its verdict + summary, merge state, and whether this user may act on it.'),
  r('GET', '/api/review/repos', 'watched PR-review repositories.', true),
  r('GET', '/api/dm/channels/:id/messages', 'messages of a DM / group channel the user belongs to. Query: ?before=<epoch ms> pages back.'),
  r('GET', '/api/requests', 'member→admin requests (a member sees their own, an admin sees all).'),
  r('GET', '/api/requests/actions', 'which admin actions a member may request, and the fields each one takes.'),
  r('GET', '/api/dm/channels', 'DM + group channels the user belongs to.'),
  r('GET', '/api/users', 'workspace users (id, username, displayName, role).'),
  r('GET', '/api/search', 'workspace-wide search. Query string: ?q=<text>. Scoped to what the user may see.'),
  r('GET', '/api/brand', 'workspace title + logo.'),
  r('GET', '/api/admin/config', 'every admin setting: value, default, type, min/max, whether a restart is needed.', true),
  r('GET', '/api/admin/overview', 'admin dashboard totals (users, sessions, rooms).', true),
  r('GET', '/api/admin/processes', 'the CLI subprocesses and code-server containers running right now.', true),
  r('GET', '/api/admin/windows-docker', 'whether the remote Windows build host is reachable and really a Windows daemon (last check only — re-testing it is not available to you).', true),
  r('GET', '/api/admin/cleanup', 'what a cleanup would remove (a preview — running the cleanup itself is not available to you).', true),
  r('GET', '/api/admin/update', 'the running version and whether a newer image is available (applying an update is not available to you).', true),

  // ── write: the user's own things ──
  r('POST', '/api/sessions', 'create a private chat. Body: { title?, projectId? }. Returns { session }. Follow it with a ui action openSession so the user lands in it.'),
  r('PATCH', '/api/sessions/:id', 'change a chat: { title?, projectId?, model?, effort? (low|medium|high|xhigh|max), permissionMode? (default|acceptEdits|plan|bypassPermissions), wikiRefId?, sandbox?, sandboxTarget?, watchMode?, watchPrompt? }. sandbox (1|0) gives this chat its own build container; sandboxTarget (linux|windows) picks the daemon it runs on — windows is the .NET Framework one and needs winSandboxEnabled. wikiRefId links an LLM Wiki topic to this chat as reference knowledge (null unlinks); ids come from GET /api/wiki/topics. watchMode (off|notify|prompt) watches the project this chat points at for changes made elsewhere; the prompt mode also needs watchPrompt, the text sent as a turn on each change ({files} / {count} / {project} are filled in).'),
  r('POST', '/api/sessions/:id/retitle', 'name a chat from its conversation (no body).'),
  r('POST', '/api/projects', 'create a project. Body: { name?, gitUrl?, branch?, credentialId? }. With gitUrl the repository is CLONED (a private repo needs a git credential already stored for that host). Omit `scope` for a personal project; scope:"common" is admin-only unless `commonProjectOpen` is on, in which case any member may create one directly — otherwise a member must file a request instead.'),
  r('POST', '/api/projects/:id/git/pull', 'pull a project working dir (no body, or { rebase: true }). Fetches every remote (--all), so branches created upstream arrive too. The current branch is fast-forward only by default — if local commits diverged it fails, and rebase:true replays them on top instead.'),
  r('POST', '/api/projects/:id/git/commit', 'commit in a project working dir. Body: { message, files?: string[] } (no `files` = everything staged/changed). Local only — nothing leaves the server until a push.'),
  r('POST', '/api/projects/:id/git/push', 'push the current branch to origin, using the git credential stored for that host. This LEAVES the server — say what will be pushed and get a yes first.'),
  r('POST', '/api/projects/:id/git/checkout', 'switch a project to another branch. Body: { branch }. Fails if the working dir has changes that would be overwritten.'),
  r('POST', '/api/rooms', 'create a shared room. Body: { name }.'),
  r('POST', '/api/rooms/:id/members', 'invite someone into a room (needs the invite right). Body: { userId } — ids come from GET /api/users.'),
  r('POST', '/api/rooms/:id/members/:userId/delegation', 'give or take one right of a room member (room owner only). Body: { perm: approve|interrupt|invite|kick|transfer|delete, on: boolean }.'),
  r('POST', '/api/rooms/:id/mode', "change a room's permission mode (room owner only, never delegable). Body: { mode: default|acceptEdits|plan|bypassPermissions }."),
  r('PATCH', '/api/rooms/:id/project', 'point a room at a project (its working directory). Body: { projectId } — null detaches it.'),
  r('POST', '/api/dm/channels/:id/read', 'mark a DM / group channel read (no body).'),
  r('POST', '/api/wiki/topics', "create an LLM Wiki topic. Body: { name, description?, seedType?: upload|session|project|blank, seedSessionId? (with seedType session), seedProjectId? (with seedType project), autoLearn?: off|ask|auto, kind?: wiki|minutes }. kind minutes = a meeting-minutes base: one document per meeting plus decision/action registers, date-cited answers. seedType picks what the base starts from: an existing chat, a project's files, or nothing at all. autoLearn is what a finished conversation may add to it. Admin-only — a member must file a request instead.", true),
  r('PATCH', '/api/wiki/topics/:id', 'change a topic: { name?, description?, autoLearn?: off|ask|auto }. autoLearn: off = never, ask = park it for a person to accept, auto = write it in. Admin-only.', true),
  r('POST', '/api/wiki/proposals/:id/decide', 'accept or discard one parked knowledge addition. Body: { accept: boolean }. Ids come from GET /api/wiki/proposals?sessionId=<chat id>.', true),
  r('POST', '/api/dm/channels', 'open a DM or group channel. Body: { kind:"dm", userId } or { kind:"group", name, memberIds }.'),
  r('PATCH', '/api/auth/me', 'the per-user toggles. Body: any of { autoTitle, autoResume, primeWindow } as booleans. primeWindow = "keep the claude.ai 5-hour window open" (5시간 선점). primeWindowSched = when it may run: { tz:"Asia/Seoul", times:["09:00"], from:"09:00", to:"19:00" } (times and range both optional; null = round the clock).'),
  r('POST', '/api/requests', 'ask an admin for an admin-only action. Body: { type, payload, reason }. Valid types come from GET /api/requests/actions.'),

  // ── write: team agents ──
  r('POST', '/api/agents', 'define a team agent. Body: { scope:"user"|"common"|"project", name (^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$), description, prompt, tools?: string[] (empty = all), model?, projectId? (scope "project") }. "common" is admin-only; "project" needs an admin or the owner of a personal project.'),
  r('PATCH', '/api/agents/:id', 'edit a team agent you may manage. Body: any of { name, description, prompt, tools, model }.'),
  r('POST', '/api/agents/:id/enabled', 'turn a team agent on/off. Body: { enabled }.'),

  // ── write: shared-plan pools (토큰 모아쓰기) ──
  r('POST', '/api/pools', 'start a pool party. Body: { name, strategy?: ""|"rotate"|"sequential" } ("" follows the admin default). Creating one does NOT put your own plan in — join separately.'),
  r('PUT', '/api/pools/:id/strategy', 'change how a pool picks the next plan. Body: { strategy: ""|"rotate"|"sequential" }. Pool owner or admin.'),
  r('POST', '/api/pools/:id/join', "put THIS user's own Claude plan into a pool (no body). It only ever acts on the caller — you cannot enrol anyone else."),
  r('POST', '/api/pools/:id/leave', 'leave a pool (no body). A pool owner or an admin may remove someone else with { userId }.'),
  r('PUT', '/api/pools/my-default', 'the pool this user runs on by default. Body: { poolId } (null = none). Only a pool they already joined.'),
  r('PUT', '/api/pools/opt-out', "keep this user's own plan out of the workspace-wide pool. Body: { optOut: boolean }."),

  // ── write: plugins / skills ──
  r('POST', '/api/plugins/install', 'install a plugin (its skills come with it). Body: { scope:"user"|"common"|"project", name?, repo?, projectId? } — name is a plugin name (looked up in the registered marketplaces) or "<plugin>@<marketplace>"; repo is "owner/repo" or a full git URL and is only needed to install straight from a repo. Either field alone works; with both, the repo is cloned under the given name. { marketplaceId, plugin } names a marketplace plugin explicitly. scope "common" is admin-only; scope "project" needs `projectId` and is allowed for an admin on any project, or for a member on their own personal project — it then applies to every chat pointed at that project. For a member with no project in mind, use "user".'),
  r('POST', '/api/plugins/:id/enabled', 'enable/disable a plugin you own — personal, or one on a project you manage (or, as admin, any). Body: { enabled }.'),
  r('POST', '/api/plugins/:id/pref', 'your personal on/off for a COMMON plugin. Body: { enabled }.'),
  r('POST', '/api/plugins/:id/update', 'pull the latest of a git-installed plugin (no body).'),
  r('POST', '/api/marketplaces', 'register a plugin marketplace. Body: { scope:"user"|"common", ref } — ref is "owner/repo" or a full git URL. The repo is cloned on the spot, so this fails on an unreachable repo or one without .claude-plugin/marketplace.json, and the name comes from that file.'),
  r('POST', '/api/marketplaces/:id/refresh', 'pull a registered marketplace repo to its latest, then return its catalog — do this when plugins were pushed there after it was added.'),

  // ── write: admin ──
  r('POST', '/api/requests/:id/decide', 'approve or reject a member request. Body: { approve: boolean, note? }.', true),
  r('POST', '/api/wiki/topics/:id/recompile', 'recompile an LLM Wiki topic after its sources changed (no body). Long-running; it reports progress in the topic itself.', true),
  r('POST', '/api/admin/models/refresh', "fetch the provider's live model list now, refreshing the model dropdown (no body).", true),
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
