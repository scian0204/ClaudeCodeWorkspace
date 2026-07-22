import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { paths, ensure } from '../lib/paths.js';
import { newId } from '../lib/ids.js';

const run = promisify(execFile);

function pluginDest(scope: 'common' | 'user', ownerId: string | null, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (scope === 'common') return path.join(paths.commonPlugins, safe);
  return path.join(paths.userHome(ownerId!), 'plugins', safe);
}

export function listPlugins(scope: 'common' | 'user', ownerId?: string) {
  if (scope === 'common') return db.select().from(schema.plugins).where(eq(schema.plugins.scope, 'common')).all();
  return db.select().from(schema.plugins)
    .where(and(eq(schema.plugins.scope, 'user'), eq(schema.plugins.ownerId, ownerId!))).all();
}

export function listMarketplaces(scope: 'common' | 'user', ownerId?: string) {
  if (scope === 'common') return db.select().from(schema.marketplaces).where(eq(schema.marketplaces.scope, 'common')).all();
  return db.select().from(schema.marketplaces)
    .where(and(eq(schema.marketplaces.scope, 'user'), eq(schema.marketplaces.ownerId, ownerId!))).all();
}

export function addMarketplace(scope: 'common' | 'user', ownerId: string | null, name: string, url: string) {
  const row = { id: newId(), scope, ownerId, name, url, createdAt: Date.now() };
  db.insert(schema.marketplaces).values(row).run();
  return row;
}
export function removeMarketplace(id: string) {
  db.delete(schema.marketplaces).where(eq(schema.marketplaces.id, id)).run();
}

async function record(scope: 'common' | 'user', ownerId: string | null, name: string, source: 'marketplace' | 'local', repo: string | null, dest: string) {
  const row = {
    id: newId(), scope, ownerId, name, source, repo, path: dest,
    enabled: 1, forced: 0, createdAt: Date.now(),
  };
  db.insert(schema.plugins).values(row).run();
  return row;
}

export async function installFromGit(scope: 'common' | 'user', ownerId: string | null, name: string, repo: string) {
  const dest = pluginDest(scope, ownerId, name);
  ensure(path.dirname(dest));
  await run('git', ['clone', '--depth', '1', repo, dest]);
  return record(scope, ownerId, name, 'marketplace', repo, dest);
}

export function getPlugin(id: string) {
  return db.select().from(schema.plugins).where(eq(schema.plugins.id, id)).get();
}

// pull one `key: value` out of a SKILL.md YAML frontmatter block (unquoted or quoted)
function frontmatter(text: string): { name?: string; description?: string } {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { name: out.name, description: out.description };
}

// Read a plugin's manifest + the skills it exposes (skills/<dir>/SKILL.md frontmatter).
export function pluginDetail(dir: string) {
  let manifest: any = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')); } catch { /* no manifest */ }
  const skills: { dir: string; name: string; description: string }[] = [];
  try {
    for (const e of fs.readdirSync(path.join(dir, 'skills'), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const md = path.join(dir, 'skills', e.name, 'SKILL.md');
      if (!fs.existsSync(md)) continue;
      const fm = frontmatter(fs.readFileSync(md, 'utf8'));
      skills.push({ dir: e.name, name: fm.name || e.name, description: fm.description || '' });
    }
  } catch { /* no skills dir */ }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { manifest, skills };
}

// Update a git-installed plugin in place: refresh to the remote's latest HEAD.
// Shallow-clone-safe (fetch depth 1 + hard reset); discards any local edits in the plugin dir.
export async function updatePlugin(id: string) {
  const p = getPlugin(id);
  if (!p) throw new Error('plugin not found');
  if (p.source !== 'marketplace' || !p.repo) throw new Error('git 저장소 플러그인만 업데이트할 수 있습니다');
  const opts = { env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/echo' } };
  await run('git', ['-C', p.path, 'fetch', '--depth', '1', 'origin', 'HEAD'], opts);
  await run('git', ['-C', p.path, 'reset', '--hard', 'FETCH_HEAD'], opts);
  await run('git', ['-C', p.path, 'clean', '-fd'], opts);
  return p;
}

// local upload: a .tar.gz of the plugin dir. Uses system tar (present in image).
export async function installFromTarball(scope: 'common' | 'user', ownerId: string | null, name: string, tarPath: string) {
  const dest = pluginDest(scope, ownerId, name);
  ensure(dest);
  await run('tar', ['-xzf', tarPath, '-C', dest, '--strip-components=0']);
  return record(scope, ownerId, name, 'local', null, dest);
}

export function setEnabled(id: string, enabled: boolean) {
  db.update(schema.plugins).set({ enabled: enabled ? 1 : 0 }).where(eq(schema.plugins.id, id)).run();
}
export function setForced(id: string, forced: boolean) {
  db.update(schema.plugins).set({ forced: forced ? 1 : 0 }).where(eq(schema.plugins.id, id)).run();
}
export function removePlugin(id: string) {
  db.delete(schema.plugins).where(eq(schema.plugins.id, id)).run();
  db.delete(schema.pluginPrefs).where(eq(schema.pluginPrefs.pluginId, id)).run();
}

// per-user on/off of a common class-2 plugin
export function setUserPref(userId: string, pluginId: string, enabled: boolean) {
  const existing = db.select().from(schema.pluginPrefs)
    .where(and(eq(schema.pluginPrefs.userId, userId), eq(schema.pluginPrefs.pluginId, pluginId))).get();
  if (existing) {
    db.update(schema.pluginPrefs).set({ enabled: enabled ? 1 : 0 })
      .where(and(eq(schema.pluginPrefs.userId, userId), eq(schema.pluginPrefs.pluginId, pluginId))).run();
  } else {
    db.insert(schema.pluginPrefs).values({ userId, pluginId, enabled: enabled ? 1 : 0 }).run();
  }
}
export function getUserPrefs(userId: string) {
  return db.select().from(schema.pluginPrefs).where(eq(schema.pluginPrefs.userId, userId)).all();
}

// Resolve enabled plugin dir paths for a session (2-class override).
export function resolvePluginPaths(kind: 'user' | 'room', ownerId: string): string[] {
  const out: string[] = [];
  const common = db.select().from(schema.plugins).where(eq(schema.plugins.scope, 'common')).all();
  for (const p of common) {
    if (p.forced) { out.push(p.path); continue; }       // class-1: mandatory
    if (!p.enabled) continue;                             // admin disabled globally
    if (kind === 'user') {
      const pref = db.select().from(schema.pluginPrefs)
        .where(and(eq(schema.pluginPrefs.userId, ownerId), eq(schema.pluginPrefs.pluginId, p.id))).get();
      if (pref && pref.enabled === 0) continue;           // user turned class-2 off
    }
    out.push(p.path);
  }
  if (kind === 'user') {
    const personal = db.select().from(schema.plugins)
      .where(and(eq(schema.plugins.scope, 'user'), eq(schema.plugins.ownerId, ownerId))).all();
    for (const p of personal) if (p.enabled) out.push(p.path);
  }
  return out;
}
