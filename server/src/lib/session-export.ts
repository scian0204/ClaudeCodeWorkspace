import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ignore, { type Ignore } from 'ignore';
import { cfg } from './config-registry.js';
import { rewriteCwd } from './session-import.js';
import { listDir, type DirEntry } from './filetree.js';
import { newId } from './ids.js';

// Session export helpers — the reverse of lib/session-import.ts.
//
// Two shapes are offered to the user:
//   1. transcript only  → the CLI's own .jsonl (routes/sessions.ts builds it with transcriptLines)
//   2. project bundle   → one .tgz with the chosen files from the session's working directory PLUS
//      that transcript already filed under `.claude/projects/<slug>/<uuid>.jsonl`, so a local
//      `claude --resume <uuid>` finds it once the two folders are put in place.
//
// The bundle is picked file by file in the browser (a lazy, one-directory-at-a-time tree), so the
// file list is settled here on the server: the same walk answers "how big is this" and "what goes
// into the archive". It streams through the system `tar` (same reasoning as admin/backup.ts: no
// extra dependency, constant memory no matter how big the project is).

// The transcript lines for one session, ready to be written out. `localCwd` (may be '') rewrites
// every line's `cwd` to the user's local path — the CLI matches transcripts against the runtime cwd,
// so without it a local resume won't list the session. `customTitle` (null to skip) carries the
// workspace title into the resume picker, in the same line shape the importer accepts.
export function transcriptLines(file: string, uuid: string, localCwd: string, customTitle: string | null): string[] {
  let lines = fs.readFileSync(file, 'utf8').split('\n');
  if (localCwd) lines = lines.map((l) => rewriteCwd(l, localCwd));
  if (customTitle && !lines.some((l) => l.includes('"custom-title"'))) {
    lines.unshift(JSON.stringify({ type: 'custom-title', customTitle, sessionId: uuid }));
  }
  return lines;
}

// Names unchecked by default (regenerable or huge): admin-editable list.
export function bundleExcludes(): Set<string> {
  return new Set(cfg.str('sessionBundleExcludes').split(',').map((s) => s.trim()).filter(Boolean));
}

// ── which files are off by default ────────────────────────────────────────────
// A `.gitignore` in any directory applies to that directory and below, so the walk carries a stack
// of matchers with the path each was read at. Cross-file negation (a `!keep` in a child undoing a
// parent's pattern) is not modelled — git's own precedence there is subtle, and nobody picking files
// in this dialog is counting on it.
type Layer = { base: string; ig: Ignore };

function readLayer(dir: string, rel: string): Layer | null {
  const gi = path.join(dir, '.gitignore');
  try {
    if (!fs.existsSync(gi)) return null;
    return { base: rel, ig: ignore().add(fs.readFileSync(gi, 'utf8')) };
  } catch { return null; }   // unreadable or malformed — treat as absent
}

function ignoredBy(layers: Layer[], rel: string, isDir: boolean): boolean {
  for (const l of layers) {
    const sub = l.base ? rel.slice(l.base.length + 1) : rel;
    if (!sub) continue;
    try { if (l.ig.ignores(isDir ? `${sub}/` : sub)) return true; } catch { /* a pattern the lib rejects */ }
  }
  return false;
}

// The matcher stack in force at `rel` — needed when the browser opens one directory and we have to
// say, for that level only, which entries are off by default.
function layersAt(root: string, rel: string): Layer[] {
  const layers: Layer[] = [];
  const push = (dir: string, at: string) => { const l = readLayer(dir, at); if (l) layers.push(l); };
  push(root, '');
  if (!rel) return layers;
  let acc = '';
  for (const p of rel.split('/')) {
    acc = acc ? `${acc}/${p}` : p;
    push(path.join(root, acc), acc);
  }
  return layers;
}

export type ExportEntry = DirEntry & { ignored: boolean };

// One directory level for the picker: the same entries an explorer would show, plus the default-off
// verdict (an excluded name, or matched by a `.gitignore` at or above this level).
export function listExportDir(root: string, rel: string, limit: number, excludeNames?: Set<string>): { entries: ExportEntry[]; truncated: boolean } {
  const excl = excludeNames ?? bundleExcludes();
  const layers = layersAt(root, rel);
  const { entries, truncated } = listDir(root, rel, { limit, skip: new Set<string>() });
  return {
    truncated,
    entries: entries.map((e) => {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      return { ...e, ignored: excl.has(e.name) || ignoredBy(layers, childRel, e.dir) };
    }),
  };
}

// The browser only ever sees the levels it opened, so it sends overrides against the defaults above:
// `exclude` = unchecked by hand, `include` = checked by hand (which also lifts the defaults for
// everything inside it). A deeper override wins over a shallower one.
export interface Selection { exclude: Set<string>; include: Set<string> }

export interface WalkResult { files: string[]; bytes: number; over: boolean; tooMany: boolean }

// Every file the bundle would carry (paths relative to `root`), with the total size. Stops early at
// `limitBytes` / `maxFiles` — a 50GB checkout must not cost a full stat sweep just to be refused.
export function walkBundle(root: string, sel: Selection, limitBytes: number, maxFiles: number, excludeNames?: Set<string>): WalkResult {
  const excl = excludeNames ?? bundleExcludes();
  const files: string[] = [];
  let bytes = 0;
  let over = false;
  let tooMany = false;

  const walk = (dir: string, rel: string, layers: Layer[], forced: boolean) => {
    if (over || tooMany) return;
    const own = readLayer(dir, rel);
    const here = own ? [...layers, own] : layers;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (over || tooMany) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (sel.exclude.has(childRel)) continue;                       // unchecked by hand
      const on = sel.include.has(childRel);                          // checked by hand
      if (!on && !forced && (excl.has(e.name) || ignoredBy(here, childRel, e.isDirectory()))) continue;
      if (e.isSymbolicLink()) continue;                              // tar stores the link, not the target's bytes
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, childRel, here, forced || on); continue; }
      if (!e.isFile()) continue;
      files.push(childRel);
      try { bytes += fs.statSync(full).size; } catch { /* vanished mid-walk */ }
      if (bytes > limitBytes) { over = true; return; }
      if (files.length > maxFiles) { tooMany = true; return; }
    }
  };
  walk(root, '', [], false);
  return { files, bytes, over, tooMany };
}

// ── the archive ───────────────────────────────────────────────────────────────

export interface BundleOpts {
  projectDir: string;    // the session's working directory — archived under its own folder name
  fileRels: string[];    // paths inside it, as walkBundle returned them
  transcript?: { slug: string; uuid: string; lines: string[] } | null;
}

// A .tgz stream with two top-level entries: `<projectFolderName>/` and (when there is a transcript)
// `.claude/projects/<slug>/<uuid>.jsonl`. Call `kill` on client disconnect; the staging dir holding
// the member list and the transcript is removed when tar exits.
export function bundleStream(o: BundleOpts): { stream: NodeJS.ReadableStream; kill: () => void; topDir: string } {
  const projectDir = path.resolve(o.projectDir);
  const parent = path.dirname(projectDir);
  const base = path.basename(projectDir);
  // tar reads the member list from a file, not argv (which a big project would blow past), and the
  // transcript is written into a throwaway dir whose layout IS the archive layout.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ccw-bundle-'));
  const listFile = path.join(staging, 'files.txt');
  fs.writeFileSync(listFile, `${o.fileRels.map((r) => `${base}/${r}`).join('\n')}\n`);
  if (o.transcript) {
    const dir = path.join(staging, '.claude', 'projects', o.transcript.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${o.transcript.uuid}.jsonl`), o.transcript.lines.join('\n'));
  }
  const args = ['-czf', '-', '-C', parent, '-T', listFile];
  if (o.transcript) args.push('-C', staging, '.claude');
  const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (b) => { err += b.toString(); });
  const cleanup = () => { try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ } };
  child.on('close', (code) => {
    cleanup();
    // exit 1 is tar's warning code ("file changed as we read it") — expected in a live workspace, and
    // the archive is still valid, so only a real failure (>= 2) becomes a stream error.
    if (code !== null && code >= 2) child.stdout.emit('error', new Error(`tar exited ${code}: ${err.slice(0, 300)}`));
  });
  child.on('error', (e) => { cleanup(); child.stdout.emit('error', e); });
  return { stream: child.stdout, kill: () => { try { child.kill(); } catch { /* already gone */ } }, topDir: base };
}

// `ccw-<title>-20260820-1530.tgz` — the title squeezed into a filename-safe slug.
export function bundleFilename(title: string | null, at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const slug = String(title || '').normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase();
  return `ccw-${slug ? `${slug}-` : ''}${stamp}.tgz`;
}

// ── download tickets ──────────────────────────────────────────────────────────
// The picked file list is far too long for a URL, and the download itself has to be a plain
// navigation (that is what streams to disk instead of filling browser memory). So the selection is
// POSTed first, kept here under a one-time token, and the GET that streams the archive quotes it.
export interface Ticket {
  userId: string;
  sessionId: string;
  projectDir: string;
  fileRels: string[];
  transcript: { slug: string; uuid: string; lines: string[] } | null;
  title: string | null;
  createdAt: number;
}

const TICKET_TTL_MS = 10 * 60 * 1000;  // the click follows within seconds; this is slack, not a feature
const MAX_TICKETS = 20;                // bounds the file lists held in memory
const tickets = new Map<string, Ticket>();

function sweepTickets(now: number) {
  for (const [k, v] of tickets) if (now - v.createdAt > TICKET_TTL_MS) tickets.delete(k);
  while (tickets.size >= MAX_TICKETS) {
    const oldest = tickets.keys().next().value;   // Map keeps insertion order → the oldest ticket
    if (!oldest) break;
    tickets.delete(oldest);
  }
}

export function putTicket(t: Omit<Ticket, 'createdAt'>, now = Date.now()): string {
  sweepTickets(now);
  const token = `${newId()}${newId()}`;
  tickets.set(token, { ...t, createdAt: now });
  return token;
}

// One-time: a token is spent by the download that quotes it, and only for the user who made it.
export function takeTicket(token: string, userId: string, now = Date.now()): Ticket | null {
  const t = tickets.get(token);
  if (!t) return null;
  if (t.userId !== userId) return null;            // someone else's token — leave it in place
  tickets.delete(token);
  return now - t.createdAt > TICKET_TTL_MS ? null : t;
}
