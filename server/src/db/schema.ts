import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'), // 'admin' | 'member'
  displayName: text('display_name').notNull(),
  avatarColor: text('avatar_color').notNull(),
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
  claudeSessionId: text('claude_session_id'), // SDK resume id
  model: text('model').notNull().default('claude-opus-4-8'),
  permissionMode: text('permission_mode').notNull().default('default'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'system'
  authorId: text('author_id'),
  authorName: text('author_name'),
  content: text('content').notNull(), // JSON
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

// per-user on/off for common (class-2) plugins
export const pluginPrefs = sqliteTable('plugin_prefs', {
  userId: text('user_id').notNull(),
  pluginId: text('plugin_id').notNull(),
  enabled: integer('enabled').notNull(),
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
