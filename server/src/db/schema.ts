import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  displayName: text('display_name').notNull(),
  avatarColor: text('avatar_color').notNull(),
  createdAt: integer('created_at').notNull(),
  claudeTokenEnc: text('claude_token_enc'),        // AES-GCM blob of the user's Claude token
  claudeTokenSetAt: integer('claude_token_set_at'), // when it was registered (display only)
  avatar: text('avatar'),                          // version token (set-time millis) for cache-busting; null = no avatar (file lives at <userHome>/avatar.<ext>)
  autoTitle: integer('auto_title').notNull().default(1), // 1 = name a fresh private chat after its topic on the first turn
  autoResume: integer('auto_resume').notNull().default(0), // 1 = re-run a turn that hit the claude.ai 5h limit once the window resets (opt-in: it runs unattended)
  primeWindow: integer('prime_window').notNull().default(0), // 1 = open a fresh claude.ai 5h window with a tiny throwaway query as soon as none is running
  primedAt: integer('primed_at'), // when the primer last opened a window (epoch ms), null = never
  defaultPoolId: text('default_pool_id'), // this user's own shared-plan pool, used when a session names none
  poolOptOut: integer('pool_opt_out').notNull().default(0), // 1 = keep my plan out of the workspace-wide pool
});

// A turn parked because its author's claude.ai plan window (5h / weekly) was exhausted. Re-enqueued
// automatically at `resumeAt`. Persisted (not just an in-memory timer) so a restart inside the ≤5h
// wait doesn't silently drop the user's prompt. See claude/auto-resume.ts.
export const pendingResumes = sqliteTable('pending_resumes', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  authorId: text('author_id').notNull(),
  authorName: text('author_name').notNull(),
  text: text('text').notNull(),
  attachments: text('attachments').notNull().default('[]'), // JSON [{name,isImage}]
  includeChat: integer('include_chat').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),        // auto-resumes this prompt already got
  resumeAt: integer('resume_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const authSessions = sqliteTable('auth_sessions', {
  id: text('id').primaryKey(), // cookie token
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  kind: text('kind').notNull(), // 'private' | 'room'
  roomId: text('room_id'),
  title: text('title').notNull(),
  projectId: text('project_id'),
  wikiTopicId: text('wiki_topic_id'), // set => this is a user's private thread under a wiki topic
  wikiRefId: text('wiki_ref_id'),     // an ORDINARY session reading a wiki topic as reference knowledge
  claudeSessionId: text('claude_session_id'), // SDK resume id
  model: text('model').notNull().default('claude-opus-4-8'),
  effort: text('effort').notNull().default('high'), // SDK effort level: low|medium|high|xhigh|max
  permissionMode: text('permission_mode').notNull().default('default'),
  agent: text('agent'), // team-agent name driving the MAIN thread (SDK options.agent); null = default Claude
  poolId: text('pool_id'),   // shared-plan pool this session's turns draw from; null = the global pool (if any)
  sandbox: integer('sandbox').notNull().default(0), // 1 = build/run in this session's own container
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ── shared-plan pools ("토큰 모아쓰기") ──
// A named group of members who agreed to let the workspace run turns on their own Claude plan.
// A turn picks ONE member's credential; when that member's plan window is exhausted the turn falls
// through to the next. `cursor` is the round-robin position for the 'rotate' strategy.
// Binding: chat_sessions.pool_id, else the workspace-wide pool (settings key 'token_pool_global').
export const tokenPools = sqliteTable('token_pools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(), // creator; may delete it (admins may delete any)
  strategy: text('strategy').notNull().default('rotate'), // 'rotate' | 'sequential' | '' = follow the admin default
  cursor: integer('cursor').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

// Membership is ALWAYS self-service: only the user themselves can add their own row (an admin can
// remove one, never insert one), so nobody's plan is ever spent without their explicit opt-in.
export const tokenPoolMembers = sqliteTable('token_pool_members', {
  poolId: text('pool_id').notNull(),
  userId: text('user_id').notNull(),
  priority: integer('priority').notNull().default(0),      // lower runs first under 'sequential'
  cooldownUntil: integer('cooldown_until').notNull().default(0), // skipped until this instant (plan window exhausted)
  joinedAt: integer('joined_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'system'
  authorId: text('author_id'),
  authorName: text('author_name'),
  content: text('content').notNull(), // JSON
  chat: integer('chat').notNull().default(0), // 1 = room team chat (not sent to Claude); role='user' only
  createdAt: integer('created_at').notNull(),
});

// ── Guide agent (the floating product-guide / control assistant) ──
// One private thread per user. Deliberately NOT stored in chat_sessions/messages: those rows are
// reachable through /api/sessions/:id, whose viewer check falls through to `true` for unknown kinds.
// Keying every row by user_id makes cross-user access impossible by construction.
export const guideThreads = sqliteTable('guide_threads', {
  userId: text('user_id').primaryKey(),
  claudeSessionId: text('claude_session_id'), // SDK resume id → the guide remembers the conversation
  updatedAt: integer('updated_at').notNull(),
});

export const guideMessages = sqliteTable('guide_messages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  role: text('role').notNull(),       // 'user' | 'assistant'
  content: text('content').notNull(), // JSON: {text} for user, {blocks} for assistant
  createdAt: integer('created_at').notNull(),
});

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(),
  chatSessionId: text('chat_session_id').notNull(),
  permissionMode: text('permission_mode').notNull().default('default'),
  createdAt: integer('created_at').notNull(),
});

export const roomMembers = sqliteTable('room_members', {
  roomId: text('room_id').notNull(),
  userId: text('user_id').notNull(),
  delegations: text('delegations').notNull().default('[]'), // JSON array of perm keys
  joinedAt: integer('joined_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(), // 'common' | 'user' | 'room'
  ownerId: text('owner_id'), // uid or roomId; null for common
  name: text('name').notNull(),
  path: text('path').notNull(),
  createdAt: integer('created_at').notNull(),
});

// LLM Wiki: admin-curated knowledge topics. Each topic is a dir of foundational .md files
// (the knowledge base). Users query it in their own private thread (chat_sessions.wikiTopicId).
export const wikiTopics = sqliteTable('wiki_topics', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  path: text('path').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
  compileStatus: text('compile_status').notNull().default('idle'), // idle|compiling|done|error
  compiledAt: integer('compiled_at'),
  compileError: text('compile_error'),
  // Grow the base from conversations: after a turn in a thread bound to this topic, a short model
  // call decides whether the exchange holds durable knowledge. 'off' = never, 'ask' = propose and
  // wait for a human, 'auto' = write it straight into raw/ + wiki/.
  autoLearn: text('auto_learn').notNull().default('off'), // off|ask|auto
});

// A knowledge addition the learner proposed but a human has not decided on yet ('ask' mode).
// Content is the finished article body — applying it is a pure file write, no second model call.
export const wikiProposals = sqliteTable('wiki_proposals', {
  id: text('id').primaryKey(),
  topicId: text('topic_id').notNull(),
  sessionId: text('session_id').notNull(), // the chat the knowledge came out of
  title: text('title').notNull(),
  slug: text('slug').notNull(),            // file stem under raw/conversations/ + wiki/conversations/
  content: text('content').notNull(),      // markdown article body
  status: text('status').notNull().default('pending'), // pending|applied|rejected
  createdBy: text('created_by').notNull(), // whoever's turn produced it (decides who sees the card)
  createdAt: integer('created_at').notNull(),
});

export const marketplaces = sqliteTable('marketplaces', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(), // 'common' | 'user'
  ownerId: text('owner_id'),
  name: text('name').notNull(),
  url: text('url').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(), // 'common' | 'user'
  ownerId: text('owner_id'),
  name: text('name').notNull(),
  source: text('source').notNull(), // 'marketplace' | 'local'
  repo: text('repo'),
  path: text('path').notNull(),
  enabled: integer('enabled').notNull().default(1),
  forced: integer('forced').notNull().default(0), // admin mandatory (class-1)
  createdAt: integer('created_at').notNull(),
});

// Team/personal/project agent definitions, applied to every spawned session via the SDK's
// programmatic `agents` option (subagents invocable via the Task tool; optionally driving the main
// thread via chat_sessions.agent). Scopes: admin-managed common + per-user personal + per-project
// (applies to any session whose projectId matches, whoever owns it).
// permissionMode is deliberately NOT stored — a per-agent mode could bypass the workspace clamp.
export const teamAgents = sqliteTable('team_agents', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),      // 'common' | 'user' | 'project'
  ownerId: text('owner_id').notNull(), // uid for 'user'; '' for 'common'/'project'
  projectId: text('project_id').notNull().default(''), // projects.id for 'project'; '' otherwise
  name: text('name').notNull(),        // SDK agent key: ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$
  description: text('description').notNull(),
  prompt: text('prompt').notNull(),
  tools: text('tools').notNull().default('[]'), // JSON string[]; [] = inherit all tools
  model: text('model'),                // null = inherit the session model
  enabled: integer('enabled').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// per-user on/off for common (class-2) plugins
export const pluginPrefs = sqliteTable('plugin_prefs', {
  userId: text('user_id').notNull(),
  pluginId: text('plugin_id').notNull(),
  enabled: integer('enabled').notNull(),
});

// Per-user skill invocation counter (one row per user + skill key). `skill` is the raw invocation
// string as it reached the CLI ('brainstorming', 'caveman:caveman-stats'); it is matched to a
// plugin's exposed skills at READ time (plugins/manager.skillKey), so a renamed or reinstalled
// plugin never needs a migration here.
export const skillUsage = sqliteTable('skill_usage', {
  userId: text('user_id').notNull(),
  skill: text('skill').notNull(),
  count: integer('count').notNull().default(0),
  lastAt: integer('last_at').notNull(),
});

export const usage = sqliteTable('usage', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sessionId: text('session_id'),
  roomId: text('room_id'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ── PR Review ──
// A watched remote repo (admin-created). Cloned once (full clone) under /data/reviews/<id>/repo;
// polled for open PRs. Each open PR becomes a review session below.
export const reviewRepos = sqliteTable('review_repos', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),      // 'github' | 'gitlab' | 'bitbucket'
  host: text('host').notNull(),              // github.com / gitlab.com / bitbucket.org / self-hosted host
  gitUrl: text('git_url').notNull(),         // clone URL
  slug: text('slug').notNull(),              // owner/repo (github/bitbucket) or full path (gitlab)
  credentialId: text('credential_id').notNull(), // git_credentials.id — merge/push-capable cred
  path: text('path').notNull(),              // local full-clone dir
  baseBranch: text('base_branch'),           // default base for PRs whose base ref we can't read
  sandboxImage: text('sandbox_image'),       // per-repo review build image; null → global reviewSandboxImage
  webhookSecret: text('webhook_secret'),     // inbound webhook secret; null → this repo's hook endpoint is off
  pollEnabled: integer('poll_enabled').notNull().default(1), // 0 → interval poller skips it (webhook/manual only)
  createdBy: text('created_by').notNull(),   // admin uid (owner of the review chat sessions)
  createdAt: integer('created_at').notNull(),
  polledAt: integer('polled_at'),            // last successful poll
  pollError: text('poll_error'),             // last poll error (display only)
});

// A PR-triggered review session. One per (repo, prNumber), backed by a chat_sessions row
// (kind='review'). cwd = a per-PR git worktree where the local merge happens.
export const reviewSessions = sqliteTable('review_sessions', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  chatSessionId: text('chat_session_id').notNull(),
  prNumber: integer('pr_number').notNull(),
  prTitle: text('pr_title').notNull(),
  prUrl: text('pr_url').notNull(),
  prState: text('pr_state').notNull().default('open'), // 'open' | 'closed'
  authorLogin: text('author_login').notNull(),         // PR author's host username
  authorUserId: text('author_user_id'),                // matched local user (read-only viewer) or null
  baseRef: text('base_ref').notNull(),
  headRef: text('head_ref').notNull(),
  headSha: text('head_sha'),
  headCloneUrl: text('head_clone_url'),                // fork source clone URL (else null = same repo)
  worktreePath: text('worktree_path'),                 // created lazily on first use/merge
  mergeState: text('merge_state').notNull().default('none'), // 'none' | 'merged' | 'conflict'
  mergedAt: integer('merged_at'),
  // auto-review pipeline result: none | running | merge_safe | do_not_merge | conflict | error
  verdict: text('verdict').notNull().default('none'),
  verdictSummary: text('verdict_summary'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// LLM provider override, encrypted at rest. Mirrors the git-credential model: a per-user profile
// overrides an admin-managed common profile. When set, it replaces the default Anthropic-token auth
// for the turn (bedrock / vertex / custom-base-URL). One profile per user + one common (unique index).
export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),        // 'user' | 'common'
  ownerId: text('owner_id').notNull(),   // user id for 'user'; '' for 'common' (keeps the unique index working)
  type: text('type').notNull(),          // 'anthropic' | 'bedrock' | 'vertex' | 'custom'
  configEnc: text('config_enc').notNull(), // AES-GCM blob of the provider config JSON (fields + secrets)
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// Member request → admin approval. A generic queue: a member submits a request for an admin-only
// action (type = an action registry key in admin/requests.ts), an admin approves/rejects it, and on
// approval the server runs the action. `payload` is the action's JSON args; `result` holds the
// execution output or error. See server/src/admin/requests.ts for the action registry.
export const adminRequests = sqliteTable('admin_requests', {
  id: text('id').primaryKey(),
  requesterId: text('requester_id').notNull(),
  type: text('type').notNull(),                 // action registry key
  payload: text('payload').notNull().default('{}'), // JSON args for the action
  reason: text('reason').notNull().default(''),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  reviewerId: text('reviewer_id'),              // admin uid; null until decided
  decidedAt: integer('decided_at'),
  result: text('result'),                       // execution result or error (set on approve)
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ── Direct messages / group chat ──
// A lightweight human-to-human messaging layer, entirely separate from Claude "rooms". No Claude
// turns, no queue — just person-to-person and group text chat. A 'dm' channel is a deduped 1:1;
// a 'group' channel has a name + any number of members. An admin can promote a group to a common
// project room (see rooms.createRoom in dm.promoteToRoom).
export const dmChannels = sqliteTable('dm_channels', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),        // 'dm' | 'group'
  name: text('name'),                  // null for dm; group display name
  createdBy: text('created_by').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const dmMembers = sqliteTable('dm_members', {
  channelId: text('channel_id').notNull(),
  userId: text('user_id').notNull(),
  lastReadAt: integer('last_read_at').notNull().default(0), // unread = messages newer than this
});

export const dmMessages = sqliteTable('dm_messages', {
  id: text('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  userId: text('user_id').notNull(),
  text: text('text').notNull(),
  createdAt: integer('created_at').notNull(),
});

// Git remote credentials (HTTPS PAT), encrypted at rest. Mirrors the Claude-token model:
// per-user creds override an admin-managed common cred, resolved by remote host.
export const gitCredentials = sqliteTable('git_credentials', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),        // 'user' | 'common'
  ownerId: text('owner_id').notNull(),   // user id for 'user'; '' for 'common' (keeps the unique index working)
  provider: text('provider').notNull(),  // 'github' | 'gitlab' | 'bitbucket' | 'other'
  host: text('host').notNull(),          // resolution key, e.g. github.com
  username: text('username').notNull(),  // git username (the PAT is the password)
  tokenEnc: text('token_enc').notNull(), // AES-GCM blob
  authorName: text('author_name'),       // optional git author override
  authorEmail: text('author_email'),     // optional git author email override
  createdAt: integer('created_at').notNull(),
});
