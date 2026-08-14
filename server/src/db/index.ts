import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { paths, ensureBaseLayout } from '../lib/paths.js';

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', display_name TEXT NOT NULL, avatar_color TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL, room_id TEXT,
  title TEXT NOT NULL, project_id TEXT, wiki_topic_id TEXT, claude_session_id TEXT,
  model TEXT NOT NULL DEFAULT 'claude-opus-4-8', effort TEXT NOT NULL DEFAULT 'high',
  permission_mode TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wiki_topics (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  compile_status TEXT NOT NULL DEFAULT 'idle', compiled_at INTEGER, compile_error TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, author_id TEXT,
  author_name TEXT, content TEXT NOT NULL, chat INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE TABLE IF NOT EXISTS guide_threads (
  user_id TEXT PRIMARY KEY, claude_session_id TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS guide_messages (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guide_messages_user ON guide_messages(user_id, created_at);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, chat_session_id TEXT NOT NULL,
  permission_mode TEXT NOT NULL DEFAULT 'default', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL, user_id TEXT NOT NULL, delegations TEXT NOT NULL DEFAULT '[]',
  joined_at INTEGER NOT NULL, PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT, name TEXT NOT NULL, path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS marketplaces (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT, name TEXT NOT NULL, url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT, name TEXT NOT NULL, source TEXT NOT NULL,
  repo TEXT, path TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, forced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_prefs (
  user_id TEXT NOT NULL, plugin_id TEXT NOT NULL, enabled INTEGER NOT NULL,
  PRIMARY KEY (user_id, plugin_id)
);
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT, room_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id, created_at);
CREATE TABLE IF NOT EXISTS skill_usage (
  user_id TEXT NOT NULL, skill TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL, PRIMARY KEY (user_id, skill)
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
CREATE TABLE IF NOT EXISTS git_credentials (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT NOT NULL,
  provider TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL, token_enc TEXT NOT NULL,
  author_name TEXT, author_email TEXT, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_git_cred_scope_owner_host ON git_credentials(scope, owner_id, host);
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT NOT NULL,
  type TEXT NOT NULL, config_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_llm_providers_scope_owner ON llm_providers(scope, owner_id);
CREATE TABLE IF NOT EXISTS review_repos (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, host TEXT NOT NULL,
  git_url TEXT NOT NULL, slug TEXT NOT NULL, credential_id TEXT NOT NULL, path TEXT NOT NULL,
  base_branch TEXT, sandbox_image TEXT, webhook_secret TEXT,
  poll_enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  polled_at INTEGER, poll_error TEXT
);
CREATE TABLE IF NOT EXISTS review_sessions (
  id TEXT PRIMARY KEY, repo_id TEXT NOT NULL, chat_session_id TEXT NOT NULL,
  pr_number INTEGER NOT NULL, pr_title TEXT NOT NULL, pr_url TEXT NOT NULL,
  pr_state TEXT NOT NULL DEFAULT 'open', author_login TEXT NOT NULL, author_user_id TEXT,
  base_ref TEXT NOT NULL, head_ref TEXT NOT NULL, head_sha TEXT, head_clone_url TEXT,
  worktree_path TEXT, merge_state TEXT NOT NULL DEFAULT 'none', merged_at INTEGER,
  verdict TEXT NOT NULL DEFAULT 'none', verdict_summary TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_review_sessions_repo_pr ON review_sessions(repo_id, pr_number);
CREATE TABLE IF NOT EXISTS admin_requests (
  id TEXT PRIMARY KEY, requester_id TEXT NOT NULL, type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT,
  decided_at INTEGER, result TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_requests_requester ON admin_requests(requester_id, created_at);
CREATE TABLE IF NOT EXISTS dm_channels (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dm_members (
  channel_id TEXT NOT NULL, user_id TEXT NOT NULL, last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);
CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_messages_channel ON dm_messages(channel_id, created_at);
CREATE TABLE IF NOT EXISTS team_agents (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT NOT NULL, project_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL, prompt TEXT NOT NULL, tools TEXT NOT NULL DEFAULT '[]', model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_resumes (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
  text TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', include_chat INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, resume_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_resumes_session ON pending_resumes(session_id);
CREATE TABLE IF NOT EXISTS token_pools (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT 'rotate', cursor INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS token_pool_members (
  pool_id TEXT NOT NULL, user_id TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER NOT NULL DEFAULT 0, joined_at INTEGER NOT NULL,
  PRIMARY KEY (pool_id, user_id)
);
`;

export let sqlite: Database.Database;
export let db: BetterSQLite3Database<typeof schema>;

export function initDb() {
  ensureBaseLayout();
  sqlite = new Database(paths.db);
  sqlite.pragma('journal_mode = WAL');
  sqlite.exec(DDL);
  // migrate pre-wiki DBs: add the column DDL can't retrofit onto an existing table
  try { sqlite.exec("ALTER TABLE chat_sessions ADD COLUMN wiki_topic_id TEXT"); } catch { /* already present */ }
  try { sqlite.exec("ALTER TABLE wiki_topics ADD COLUMN compile_status TEXT NOT NULL DEFAULT 'idle'"); } catch { /* already present */ }
  try { sqlite.exec("ALTER TABLE wiki_topics ADD COLUMN compiled_at INTEGER"); } catch { /* already present */ }
  try { sqlite.exec("ALTER TABLE wiki_topics ADD COLUMN compile_error TEXT"); } catch { /* already present */ }
  // per-user Claude token (encrypted at rest)
  try { sqlite.exec("ALTER TABLE users ADD COLUMN claude_token_enc TEXT"); } catch { /* already present */ }
  try { sqlite.exec("ALTER TABLE users ADD COLUMN claude_token_set_at INTEGER"); } catch { /* already present */ }
  // per-user avatar version token (cache-bust key; image file on disk under the user's home dir)
  try { sqlite.exec("ALTER TABLE users ADD COLUMN avatar TEXT"); } catch { /* already present */ }
  // per-user auto session titling (on by default)
  try { sqlite.exec("ALTER TABLE users ADD COLUMN auto_title INTEGER NOT NULL DEFAULT 1"); } catch { /* already present */ }
  // per-user auto-resume when the claude.ai 5h window resets (off by default — it runs unattended)
  try { sqlite.exec("ALTER TABLE users ADD COLUMN auto_resume INTEGER NOT NULL DEFAULT 0"); } catch { /* already present */ }
  // per-user 5h-window primer: open a fresh window with a tiny query as soon as none is running
  try { sqlite.exec("ALTER TABLE users ADD COLUMN prime_window INTEGER NOT NULL DEFAULT 0"); } catch { /* already present */ }
  try { sqlite.exec("ALTER TABLE users ADD COLUMN primed_at INTEGER"); } catch { /* already present */ }
  // auto-review verdict (added to an already-created review_sessions table)
  try { sqlite.exec("ALTER TABLE review_sessions ADD COLUMN verdict TEXT NOT NULL DEFAULT 'none'"); } catch { /* already present */ }
  try { sqlite.exec("ALTER TABLE review_sessions ADD COLUMN verdict_summary TEXT"); } catch { /* already present */ }
  // room team-chat flag (messages not sent to Claude)
  try { sqlite.exec("ALTER TABLE messages ADD COLUMN chat INTEGER NOT NULL DEFAULT 0"); } catch { /* already present */ }
  // per-repo review build image (null → global reviewSandboxImage)
  try { sqlite.exec("ALTER TABLE review_repos ADD COLUMN sandbox_image TEXT"); } catch { /* already present */ }
  // per-repo inbound webhook secret (null → the repo's webhook endpoint is off)
  try { sqlite.exec("ALTER TABLE review_repos ADD COLUMN webhook_secret TEXT"); } catch { /* already present */ }
  // per-repo interval polling (0 = webhook/manual only; existing repos keep polling)
  try { sqlite.exec("ALTER TABLE review_repos ADD COLUMN poll_enabled INTEGER NOT NULL DEFAULT 1"); } catch { /* already present */ }
  // per-session SDK effort level (unsupported models silently downgrade)
  try { sqlite.exec("ALTER TABLE chat_sessions ADD COLUMN effort TEXT NOT NULL DEFAULT 'high'"); } catch { /* already present */ }
  // per-session main-thread team agent (SDK options.agent); null = default Claude
  try { sqlite.exec("ALTER TABLE chat_sessions ADD COLUMN agent TEXT"); } catch { /* already present */ }
  // per-session shared-plan pool (null = the workspace-wide pool, if one is set)
  try { sqlite.exec("ALTER TABLE chat_sessions ADD COLUMN pool_id TEXT"); } catch { /* already present */ }
  // per-session build container (0 = build/run in the app container, as before)
  try { sqlite.exec("ALTER TABLE chat_sessions ADD COLUMN sandbox INTEGER NOT NULL DEFAULT 0"); } catch { /* already present */ }
  // project-scope team agents ('' for common/user rows). The unique index must include project_id,
  // so it is (re)created here — after the ALTER — instead of in the DDL block.
  try { sqlite.exec("ALTER TABLE team_agents ADD COLUMN project_id TEXT NOT NULL DEFAULT ''"); } catch { /* already present */ }
  sqlite.exec("DROP INDEX IF EXISTS idx_team_agents_scope_owner_name");
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_team_agents_scope_owner_proj_name ON team_agents(scope, owner_id, project_id, name)");
  db = drizzle(sqlite, { schema });
  return db;
}

export { schema };
