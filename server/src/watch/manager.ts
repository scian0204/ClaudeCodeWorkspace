// Project file-change watch.
//
// A project directory is shared: another chat's turn writes to it, someone edits it in the VS Code
// view, a `git pull` rewrites half of it. A chat pointed at that project had no way to hear about
// any of it. Each session opts in for ITSELF (chat_sessions.watch_mode):
//
//   'off'    — never look (the pre-existing behaviour)
//   'notify' — post a notice into the session listing what changed
//   'prompt' — notice + send the session's stored prompt as an ordinary turn
//
// Only projects that at least one session subscribes to are watched, so the feature costs nothing
// until somebody turns it on. `projectWatchScope` decides which projects may be subscribed to at all
// (default: the shared ones — common + room).
//
// A session is never told about the files ITS OWN turn just wrote: writes land slightly after the
// turn ends, so changes are ignored while the turn runs and for `projectWatchGraceMs` after it. That
// is also what keeps 'prompt' mode from answering itself forever. Two DIFFERENT sessions watching
// the same project could still ping-pong (each one's turn is the other's "someone changed a file"),
// so 'prompt' additionally honours a per-session cooldown.
import fs from 'node:fs';
import path from 'node:path';
import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { cfg, registerApply } from '../lib/config-registry.js';
import { SKIP_DIRS } from '../lib/filetree.js';
import { getUserById } from '../auth/index.js';
import { isTurnActive, lastTurnEndAt } from '../claude/session-manager.js';
import { enqueueTurn, queueState } from '../rooms/queue.js';
import { emitToSession, emitToUser } from '../realtime/io.js';
import * as rooms from '../rooms/manager.js';

export const WATCH_MODES = ['off', 'notify', 'prompt'] as const;
export type WatchMode = (typeof WATCH_MODES)[number];

interface Watched {
  dir: string;
  watcher: fs.FSWatcher;
  pending: Set<string>;         // repo-relative paths changed since the last notice
  timer: NodeJS.Timeout | null; // debounce: one save touches several files
  startedAt: number;
}

const watched = new Map<string, Watched>();   // projectId -> its OS watch
const lastPrompt = new Map<string, number>(); // sessionId -> when 'prompt' mode last sent a turn
const errors = new Map<string, string>();     // projectId -> why its watch is not running
let syncTimer: NodeJS.Timeout | null = null;

// Which project scopes may be watched, per the admin setting.
function scopeAllowed(scope: string): boolean {
  const mode = cfg.str('projectWatchScope');
  if (mode === 'all') return true;
  if (mode === 'common') return scope === 'common';
  return scope === 'common' || scope === 'room'; // 'shared'
}

interface Sub { sessionId: string; mode: WatchMode; prompt: string; projectId: string }

// Every session subscribing right now, grouped by project. Read fresh at each use: a chat may have
// been deleted, re-pointed at another project, or switched off since the watch started.
function subscriptions(): Map<string, Sub[]> {
  const rows = db.select().from(schema.chatSessions)
    .where(and(ne(schema.chatSessions.watchMode, 'off'), isNotNull(schema.chatSessions.projectId))).all();
  const byProject = new Map<string, Sub[]>();
  for (const r of rows) {
    const p = db.select().from(schema.projects).where(eq(schema.projects.id, r.projectId!)).get();
    if (!p || !scopeAllowed(p.scope)) continue;
    const list = byProject.get(p.id) || [];
    list.push({ sessionId: r.id, mode: r.watchMode as WatchMode, prompt: r.watchPrompt, projectId: p.id });
    byProject.set(p.id, list);
  }
  return byProject;
}

function projectDir(projectId: string): string | null {
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  return p ? path.resolve(p.path) : null;
}
function projectName(projectId: string): string {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get()?.name || '';
}

// Bloat dirs never produce a notice worth reading (node_modules churn on every install, .git on every
// commit), and they are the bulk of the events a build emits. Editor scratch files go too.
export function ignoredPath(rel: string): boolean {
  const parts = rel.split('/');
  return parts.some((seg) => SKIP_DIRS.has(seg))
    || parts.some((seg) => seg.endsWith('.swp') || seg.endsWith('~') || seg.startsWith('.#'));
}

export function fillPlaceholders(tpl: string, files: string[], count: number, project: string): string {
  return tpl
    .replace(/\{files\}/g, files.join('\n'))
    .replace(/\{count\}/g, String(count))
    .replace(/\{project\}/g, project);
}

function stop(projectId: string) {
  const w = watched.get(projectId);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  try { w.watcher.close(); } catch { /* already gone */ }
  watched.delete(projectId);
}

function start(projectId: string) {
  const dir = projectDir(projectId);
  if (!dir || !fs.existsSync(dir)) { errors.set(projectId, 'directory missing'); return; }
  try {
    // Recursive watching is a kernel feature (inotify on Linux); a project is one directory tree, so
    // one watch covers it. Node throws here if the platform can't do recursive — surfaced, not hidden.
    const watcher = fs.watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = String(filename).split(path.sep).join('/');
      if (!rel || ignoredPath(rel)) return;
      const w = watched.get(projectId);
      if (!w) return;
      w.pending.add(rel);
      if (w.timer) clearTimeout(w.timer);
      w.timer = setTimeout(() => { void flush(projectId); }, cfg.int('projectWatchDebounceMs'));
    });
    // A watch whose directory was renamed or removed errors out. Drop the entry so the next sync
    // re-arms it instead of leaving a dead watcher in the map forever.
    watcher.on('error', (e) => { errors.set(projectId, String((e as any)?.message || e)); stop(projectId); });
    watched.set(projectId, { dir, watcher, pending: new Set(), timer: null, startedAt: Date.now() });
    errors.delete(projectId);
  } catch (e: any) {
    errors.set(projectId, String(e?.message || e));
    console.warn(`[watch] cannot watch ${dir}: ${e?.message || e}`);
  }
}

// One notice per project per debounce window, fanned out to that project's subscribers.
function flush(projectId: string) {
  const w = watched.get(projectId);
  if (!w) return;
  if (w.timer) { clearTimeout(w.timer); w.timer = null; }
  // Creating a directory reports the directory itself; listing "src" next to real files reads as
  // noise. A path that no longer exists is KEPT — that is a deletion, which is worth reporting.
  const changed = [...w.pending].filter((rel) => {
    try { return !fs.statSync(path.join(w.dir, rel)).isDirectory(); } catch { return true; }
  });
  w.pending.clear();
  if (!changed.length) return;

  const subs = subscriptions().get(projectId) || [];
  if (!subs.length) { stop(projectId); return; } // last subscriber left mid-window
  const now = Date.now();
  const grace = cfg.int('projectWatchGraceMs');
  const files = changed.slice(0, cfg.int('projectWatchMaxFiles'));
  const name = projectName(projectId);

  for (const sub of subs) {
    // Was this session working while the files moved? Then the change is probably its OWN turn's
    // writing. It still gets the notice (marked `self`, so the card can say so) — a change made by
    // someone else at that same moment must not be thrown away, which is what dropping it did.
    const own = isTurnActive(sub.sessionId) || now - lastTurnEndAt(sub.sessionId) < grace;
    const payload = {
      sessionId: sub.sessionId, projectId, projectName: name,
      files, count: changed.length, at: now, mode: sub.mode, self: own,
    };
    emitToSession(sub.sessionId, 'project:changed', payload);
    // Also reaches the tabs that are looking at a DIFFERENT chat, so the sidebar can mark the row.
    for (const uid of recipients(sub.sessionId)) emitToUser(uid, 'project:changed', payload);
    // Auto-sending is the part that must stay guarded: queueing a prompt about the files a running
    // turn is writing would make that turn write again, forever. So it waits for an idle session.
    if (sub.mode === 'prompt' && !own) maybePrompt(sub, files, changed.length, name, now);
  }
}

// Whose tabs should hear about it: the chat's owner, or every member of the room that owns it.
function recipients(sessionId: string): string[] {
  const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, sessionId)).get();
  if (!s) return [];
  if (s.kind === 'room' && s.roomId) return rooms.getMembers(s.roomId).map((m) => m.userId);
  return [s.ownerId];
}

// 'prompt' mode: put the stored prompt into the session's own turn queue, as if its owner had sent it.
function maybePrompt(sub: Sub, files: string[], count: number, project: string, now: number) {
  if (!cfg.bool('projectWatchPromptEnabled')) return;
  const text = fillPlaceholders(sub.prompt || '', files, count, project).trim();
  if (!text) return;
  if (now - (lastPrompt.get(sub.sessionId) || 0) < cfg.int('projectWatchCooldownMs')) return;
  // Something is already waiting in this session — piling another prompt on top only makes a backlog.
  const q = queueState(sub.sessionId);
  if (q.running || q.waiting.length) return;
  const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, sub.sessionId)).get();
  if (!s) return;
  // The turn runs on the session OWNER's Claude auth (a room's owner row is its creator), the same
  // account that would pay for it if they had typed the prompt themselves.
  const owner = getUserById(s.ownerId);
  if (!owner) return;
  lastPrompt.set(sub.sessionId, now);
  emitToSession(sub.sessionId, 'project:watchFired', { sessionId: sub.sessionId, projectId: sub.projectId, at: now });
  enqueueTurn(sub.sessionId, { id: owner.id, name: owner.displayName }, text);
}

// Bring the running watches in line with what the sessions actually subscribe to. Safe to call at any
// time; called after a subscription changes, after a chat/project is deleted, and on a timer.
export function syncWatchers() {
  if (!cfg.bool('projectWatchEnabled')) {
    for (const id of [...watched.keys()]) stop(id);
    return;
  }
  const subs = subscriptions();
  for (const id of [...watched.keys()]) if (!subs.has(id)) stop(id);
  const max = cfg.int('projectWatchMaxProjects');
  const room = Math.max(0, max - watched.size);
  const fresh = [...subs.keys()].filter((id) => !watched.has(id));
  for (const id of fresh.slice(0, room)) start(id);
  const dropped = fresh.slice(room);
  if (dropped.length) {
    console.warn(`[watch] projectWatchMaxProjects=${max} reached — not watching ${dropped.length} more project(s): ${dropped.join(', ')}`);
    for (const id of dropped) errors.set(id, `projectWatchMaxProjects (${max}) reached`);
  }
}

// What the UI shows next to the switch: is this project actually being watched, and if not, why.
export function watchStatus(projectId: string): { watching: boolean; since: number | null; error: string | null } {
  const w = watched.get(projectId);
  return { watching: !!w, since: w?.startedAt ?? null, error: w ? null : (errors.get(projectId) || null) };
}

export function startProjectWatch() {
  syncWatchers();
  const ms = cfg.int('projectWatchSyncMs');
  if (syncTimer) clearInterval(syncTimer);
  // Self-heal: a watcher left behind by a chat that vanished, or a directory that came back after
  // being missing, is picked up here without anything having to call sync().
  if (ms > 0) { syncTimer = setInterval(() => { try { syncWatchers(); } catch { /* keep the timer */ } }, ms); syncTimer.unref?.(); }
}

// Admin edits take effect without a restart: flipping the feature off closes every watch, narrowing
// the scope drops the projects it no longer covers, and a new interval re-arms the self-heal timer.
registerApply('projectWatchEnabled', () => startProjectWatch());
registerApply('projectWatchScope', () => syncWatchers());
registerApply('projectWatchMaxProjects', () => syncWatchers());
registerApply('projectWatchSyncMs', () => startProjectWatch());
