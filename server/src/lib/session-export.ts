import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cfg } from './config-registry.js';
import { rewriteCwd } from './session-import.js';

// Session export helpers — the reverse of lib/session-import.ts.
//
// Two shapes are offered to the user:
//   1. transcript only  → the CLI's own .jsonl (routes/sessions.ts builds it with transcriptLines)
//   2. project bundle   → one .tgz with the session's working directory PLUS that transcript already
//      filed under `.claude/projects/<slug>/<uuid>.jsonl`, so a local `claude --resume <uuid>` finds
//      it once the two folders are put in place.
//
// The bundle streams through the system `tar` (same reasoning as admin/backup.ts: no extra
// dependency, constant memory no matter how big the project is).

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

// Directory/file names left out of a bundle (regenerable or huge): admin-editable list.
export function bundleExcludes(): string[] {
  return cfg.str('sessionBundleExcludes').split(',').map((s) => s.trim()).filter(Boolean);
}

// tar --exclude patterns for one name. Two forms per name on purpose: GNU tar matches patterns
// unanchored (either form hits), while bsdtar (a Windows/macOS dev box) matches the whole member
// path — there `*/node_modules` is what catches the nested ones.
export function excludeArgs(names: string[]): string[] {
  return names.flatMap((n) => [`--exclude=${n}`, `--exclude=*/${n}`]);
}

export interface DirSize { bytes: number; files: number; over: boolean }

// What the bundle will actually carry (excludes applied, symlinks not followed, so no loops and no
// double counting). Stops as soon as `limitBytes` is passed — a 50GB checkout must not cost a full
// stat sweep just to tell the user it is too big.
export function measureDir(dir: string, excludes: string[], limitBytes: number): DirSize {
  const skip = new Set(excludes);
  let bytes = 0;
  let files = 0;
  let over = false;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (over) return;
      if (skip.has(e.name)) continue;
      if (e.isSymbolicLink()) continue;          // tar stores the link, not the target's bytes
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;
      files++;
      try { bytes += fs.statSync(full).size; } catch { /* vanished mid-walk */ }
      if (bytes > limitBytes) { over = true; return; }
    }
  };
  walk(dir);
  return { bytes, files, over };
}

export interface BundleOpts {
  projectDir: string;   // the session's working directory — archived under its own folder name
  excludes: string[];
  transcript?: { slug: string; uuid: string; lines: string[] } | null;
}

// A .tgz stream with two top-level entries: `<projectFolderName>/` and (when there is a transcript)
// `.claude/projects/<slug>/<uuid>.jsonl`. Call `kill` on client disconnect; the staging dir holding
// the transcript is removed when tar exits.
export function bundleStream(o: BundleOpts): { stream: NodeJS.ReadableStream; kill: () => void; topDir: string } {
  const projectDir = path.resolve(o.projectDir);
  const parent = path.dirname(projectDir);
  const base = path.basename(projectDir);
  // tar can only add a file that exists on disk, so the transcript is written to a throwaway dir
  // whose layout IS the archive layout (.claude/projects/<slug>/…).
  let staging: string | null = null;
  if (o.transcript) {
    staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ccw-bundle-'));
    const dir = path.join(staging, '.claude', 'projects', o.transcript.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${o.transcript.uuid}.jsonl`), o.transcript.lines.join('\n'));
  }
  const args = ['-czf', '-', ...excludeArgs(o.excludes), '-C', parent, base];
  if (staging) args.push('-C', staging, '.claude');
  const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (b) => { err += b.toString(); });
  const cleanup = () => { if (staging) { try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ } } };
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
