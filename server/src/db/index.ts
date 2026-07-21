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
  model TEXT NOT NULL DEFAULT 'claude-opus-4-8', permission_mode TEXT NOT NULL DEFAULT 'default',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wiki_topics (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  compile_status TEXT NOT NULL DEFAULT 'idle', compiled_at INTEGER, compile_error TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, author_id TEXT,
  author_name TEXT, content TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
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
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
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
  db = drizzle(sqlite, { schema });
  return db;
}

export { schema };
