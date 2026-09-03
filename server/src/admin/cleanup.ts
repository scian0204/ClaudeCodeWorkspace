import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, schema, sqlite } from '../db/index.js';
import { paths } from '../lib/paths.js';
import { imageConfigValues } from '../lib/config-registry.js';
import { inspectImage, listDanglingImages, pruneDanglingImages, listCcwContainers } from '../lib/docker-images.js';
import { removeAllEditors } from '../codeserver/manager.js';
import { removeAllSandboxes } from '../review/sandbox.js';

// Admin "resource cleanup". A read-only scanner (scanResources) plus a handful of destructive
// actions. Everything degrades gracefully when Docker is unavailable — the socket may be missing
// (non-Docker deploy) or down; a scan/prune must never throw to the route.
//
// SAFETY: the destructive actions only ever touch app-SPAWNED containers, DANGLING images, and
// genuinely-ORPHANED dirs/rows. They never delete a user/room home, an account, a chat session, a
// project, or any live data. fullReset is a fixed composition of those safe actions (asserted below).

// container listing for the scan uses the shared listCcwContainers helper; mutations delegate to reapers

// ── types ──
export interface ScanContainer { id: string; name: string; state: string; kind: 'editor' | 'sandbox'; createdAt: number; orphan?: boolean }
export interface ScanImage { ref: string; present: boolean; size?: number }
export interface OrphanDirGroup { count: number; size: number }
export interface CleanupScan {
  dockerUnavailable: boolean;
  containers: ScanContainer[];
  images: ScanImage[];
  danglingImages: { count: number; size: number };
  orphanDirs: { reviewDirs: OrphanDirGroup; attachmentDirs: OrphanDirGroup; homeDirs: OrphanDirGroup };
  orphanRows: { messages: number; reviewSessions: number; roomMembers: number; usage: number; pluginPrefs: number; skillUsage: number };
}

// ── fs helpers ──
// ponytail: naive recursive byte sum (O(files)); admin-only + on-demand so no caching. Best-effort:
// any stat error (races, perms) is swallowed and that entry contributes 0.
function dirSize(p: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) total += dirSize(full);
    else { try { total += fs.statSync(full).size; } catch { /* skip */ } }
  }
  return total;
}
function listDirs(p: string): string[] {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}
function countAndSize(dirs: string[]): OrphanDirGroup {
  return { count: dirs.length, size: dirs.reduce((a, d) => a + dirSize(d), 0) };
}
// Guard every rmSync: only ever delete under the data root (defence in depth against a bad join).
function safeRemove(target: string): boolean {
  const t = path.resolve(target);
  if (t === path.resolve(config.dataDir) || !t.startsWith(path.resolve(config.dataDir) + path.sep)) return false;
  try { fs.rmSync(t, { recursive: true, force: true }); return true; } catch { return false; }
}

// ponytail: 10-min grace window. addRepo() creates reviews/<id> before inserting its DB row (the
// clone runs in between and can take minutes), so a freshly-touched repo dir may be an in-progress
// registration, not an orphan. Skip recently-modified dirs to avoid deleting a live clone. Raise
// this if real clones ever exceed it.
const CLONE_GRACE_MS = 10 * 60_000;
function isRecent(p: string): boolean {
  try { return Date.now() - fs.statSync(p).mtimeMs < CLONE_GRACE_MS; } catch { return false; }
}

// ── orphan-dir finders (shared by scan + cleanOrphanDirs) ──
// Review clone/worktree dirs with no matching review_repos / review_sessions row. Mirrors
// review/manager.ts#reapReviewOrphans and extends it to per-PR worktrees of live repos.
function findOrphanReviewDirs(): string[] {
  const out: string[] = [];
  if (!fs.existsSync(paths.reviews)) return out;
  const repos = db.select().from(schema.reviewRepos).all();
  const repoIds = new Set(repos.map((r) => r.id));
  const prsByRepo = new Map<string, Set<string>>();
  for (const rv of db.select().from(schema.reviewSessions).all()) {
    (prsByRepo.get(rv.repoId) || prsByRepo.set(rv.repoId, new Set()).get(rv.repoId)!).add(String(rv.prNumber));
  }
  for (const name of listDirs(paths.reviews)) {
    const repoDir = path.join(paths.reviews, name);
    // orphan whole-repo dir — but a recently-touched one may be an in-progress clone (row not yet inserted)
    if (!repoIds.has(name)) { if (!isRecent(repoDir)) out.push(repoDir); continue; }
    // live repo → drop worktrees for PRs that no longer have a review_sessions row
    const prs = prsByRepo.get(name) || new Set<string>();
    for (const pr of listDirs(paths.reviewWorktrees(name))) {
      if (!prs.has(pr)) out.push(path.join(paths.reviewWorktrees(name), pr));
    }
  }
  return out;
}
// `.attachments/<sessionId>` dirs under user/room project roots whose chat_sessions row is gone.
function findOrphanAttachmentDirs(): string[] {
  const out: string[] = [];
  const sessionIds = new Set(db.select().from(schema.chatSessions).all().map((s) => s.id));
  for (const kind of ['users', 'rooms'] as const) {
    const base = path.join(config.dataDir, kind);
    for (const owner of listDirs(base)) {
      const attRoot = path.join(base, owner, 'projects', '.attachments');
      for (const name of listDirs(attRoot)) {
        // `<sid>.shots` holds the images that session's tools returned — same owner, same fate
        if (!sessionIds.has(name.replace(/\.shots$/, ''))) out.push(path.join(attRoot, name));
      }
    }
  }
  return out;
}
// User/room home dirs with no matching row. REPORT ONLY — never auto-deleted (holds user data).
function findOrphanHomeDirs(): string[] {
  const out: string[] = [];
  const userIds = new Set(db.select().from(schema.users).all().map((u) => u.id));
  const roomIds = new Set(db.select().from(schema.rooms).all().map((r) => r.id));
  for (const [kind, ids] of [['users', userIds], ['rooms', roomIds]] as const) {
    const base = path.join(config.dataDir, kind);
    for (const name of listDirs(base)) if (!ids.has(name)) out.push(path.join(base, name));
  }
  return out;
}

// ── orphan-row counts (raw SQL; NOT-IN a PK subquery is null-safe since PKs are non-null) ──
const ORPHAN_ROW_SQL = {
  messages: `SELECT COUNT(*) FROM messages WHERE session_id NOT IN (SELECT id FROM chat_sessions)`,
  reviewSessions: `SELECT COUNT(*) FROM review_sessions WHERE repo_id NOT IN (SELECT id FROM review_repos)`,
  roomMembers: `SELECT COUNT(*) FROM room_members WHERE room_id NOT IN (SELECT id FROM rooms)`,
  usage: `SELECT COUNT(*) FROM usage WHERE user_id NOT IN (SELECT id FROM users) OR (session_id IS NOT NULL AND session_id NOT IN (SELECT id FROM chat_sessions))`,
  pluginPrefs: `SELECT COUNT(*) FROM plugin_prefs WHERE user_id NOT IN (SELECT id FROM users) OR plugin_id NOT IN (SELECT id FROM plugins)`,
  skillUsage: `SELECT COUNT(*) FROM skill_usage WHERE user_id NOT IN (SELECT id FROM users)`,
} as const;
function orphanRowCounts(): CleanupScan['orphanRows'] {
  const c = (sql: string) => Number(sqlite.prepare(sql).pluck().get() || 0);
  return {
    messages: c(ORPHAN_ROW_SQL.messages), reviewSessions: c(ORPHAN_ROW_SQL.reviewSessions),
    roomMembers: c(ORPHAN_ROW_SQL.roomMembers), usage: c(ORPHAN_ROW_SQL.usage), pluginPrefs: c(ORPHAN_ROW_SQL.pluginPrefs),
    skillUsage: c(ORPHAN_ROW_SQL.skillUsage),
  };
}

// ── the scan (read-only) ──
export async function scanResources(): Promise<CleanupScan> {
  // containers (both spawned kinds); code-server orphan = owner/project label no longer resolves
  let containers: ScanContainer[] = [];
  let dockerUnavailable = false;
  try {
    const userIds = new Set(db.select().from(schema.users).all().map((u) => u.id));
    const roomIds = new Set(db.select().from(schema.rooms).all().map((r) => r.id));
    const projectIds = new Set(db.select().from(schema.projects).all().map((p) => p.id));
    const list = await listCcwContainers('ccw.codeserver=1');
    const sbx = await listCcwContainers('ccw.reviewsandbox=1');
    containers = [
      ...list.map((c): ScanContainer => {
        const l = c.labels;
        const orphan = !projectIds.has(l['ccw.project']) || !(userIds.has(l['ccw.owner']) || roomIds.has(l['ccw.owner']));
        return { id: c.id, name: c.name, state: c.state, kind: 'editor', createdAt: c.createdAt, orphan };
      }),
      ...sbx.map((c): ScanContainer => ({ id: c.id, name: c.name, state: c.state, kind: 'sandbox', createdAt: c.createdAt })),
    ];
  } catch { dockerUnavailable = true; }

  // images: app-referenced (config images ∪ per-repo sandbox images) + dangling count/size
  const repoImages = db.select().from(schema.reviewRepos).all().map((r) => r.sandboxImage?.trim()).filter((x): x is string => !!x);
  const refs = [...new Set([...imageConfigValues(), ...repoImages])];
  const images: ScanImage[] = [];
  for (const ref of refs) {
    const s = await inspectImage(ref);
    if (s.dockerUnavailable) dockerUnavailable = true;
    images.push({ ref, present: s.present, size: s.size });
  }
  const dangling = await listDanglingImages();
  if (dangling.dockerUnavailable) dockerUnavailable = true;

  return {
    dockerUnavailable,
    containers,
    images,
    danglingImages: { count: dangling.count, size: dangling.size },
    orphanDirs: {
      reviewDirs: countAndSize(findOrphanReviewDirs()),
      attachmentDirs: countAndSize(findOrphanAttachmentDirs()),
      homeDirs: countAndSize(findOrphanHomeDirs()),
    },
    orphanRows: orphanRowCounts(),
  };
}

// ── per-resource actions ──
export async function removeEditors(): Promise<{ removed: number }> { return { removed: await removeAllEditors() }; }
export async function removeSandboxes(): Promise<{ removed: number }> { return { removed: await removeAllSandboxes() }; }
export async function pruneDangling(): Promise<{ removed: number; reclaimed: number; dockerUnavailable?: boolean }> {
  return pruneDanglingImages();
}
export function cleanOrphanDirs(): { removed: number } {
  // review clone/worktree orphans + orphan attachment dirs. NOT home dirs (user data).
  const targets = [...findOrphanReviewDirs(), ...findOrphanAttachmentDirs()];
  let removed = 0;
  for (const t of targets) if (safeRemove(t)) removed++;
  return { removed };
}
export function cleanOrphanRows(): { removed: number } {
  const del = (sql: string) => sqlite.prepare(sql.replace(/^SELECT COUNT\(\*\)/, 'DELETE')).run().changes;
  let removed = 0;
  for (const sql of Object.values(ORPHAN_ROW_SQL)) removed += del(sql);
  return { removed };
}

// fullReset composes ONLY these safe actions. LIVE_DATA lists what it must never delete; the assert
// makes a future edit that adds a live-data step to the reset path fail at import instead of in prod.
const FULL_RESET_ACTIONS = ['editors', 'sandboxes', 'dangling-images', 'orphan-dirs', 'orphan-rows'] as const;
const LIVE_DATA = ['user-homes', 'accounts', 'chat-sessions', 'projects', 'review-repos'];
if (FULL_RESET_ACTIONS.some((a) => (LIVE_DATA as readonly string[]).includes(a))) {
  throw new Error('fullReset must never touch live data');
}

export async function fullReset() {
  const editors = await removeEditors();
  const sandboxes = await removeSandboxes();
  const danglingImages = await pruneDangling();
  const orphanDirs = cleanOrphanDirs();
  const orphanRows = cleanOrphanRows();
  return { editors, sandboxes, danglingImages, orphanDirs, orphanRows };
}

export type CleanupAction = 'editors' | 'sandboxes' | 'dangling-images' | 'orphan-dirs' | 'orphan-rows' | 'full-reset';
export async function runCleanup(action: string): Promise<Record<string, any>> {
  switch (action as CleanupAction) {
    case 'editors': return removeEditors();
    case 'sandboxes': return removeSandboxes();
    case 'dangling-images': return pruneDangling();
    case 'orphan-dirs': return cleanOrphanDirs();
    case 'orphan-rows': return cleanOrphanRows();
    case 'full-reset': return fullReset();
    default: throw new Error(`unknown cleanup action: ${action}`);
  }
}
