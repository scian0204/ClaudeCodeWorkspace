import path from 'node:path';
import fs from 'node:fs';

export type FileItem = { name: string; size: number };

// dirs never worth showing in an explorer (bloat / vcs / build output)
export const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'out', '.venv', 'venv',
  '__pycache__', '.cache', 'vendor', 'target', '.idea', '.gradle', '.turbo', 'coverage']);
const MAX_FILES = 5000; // cap tree size so huge repos don't hang the client

// recursively list files (root-relative paths + sizes), skipping bloat dirs, depth+count capped
export function walkFiles(dir: string, base = '', out: FileItem[] = [], depth = 0): FileItem[] {
  if (depth > 14 || out.length >= MAX_FILES || !fs.existsSync(dir)) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkFiles(path.join(dir, e.name), base ? `${base}/${e.name}` : e.name, out, depth + 1); }
    else if (e.isFile()) { let size = 0; try { size = fs.statSync(path.join(dir, e.name)).size; } catch { /* noop */ } out.push({ name: base ? `${base}/${e.name}` : e.name, size }); }
  }
  return out;
}

export type DirEntry = { name: string; dir: boolean; size: number; count: number };

// ONE directory level — what the lazy explorers ask for as the user opens folders, instead of a
// whole-tree walk that a big repo turns into a multi-thousand-entry payload. `count` is a
// subdirectory's immediate child count, so the client can warn before opening something huge.
// `limit` caps a single monstrous directory; `skip` hides names entirely (bloat dirs in the
// read-only explorers, nothing in the export picker — there the user decides).
export function listDir(root: string, rel: string, opts: { limit?: number; skip?: Set<string> } = {}): { entries: DirEntry[]; truncated: boolean } {
  const limit = opts.limit ?? 2000;
  const skip = opts.skip ?? SKIP_DIRS;
  const dir = rel ? resolveUnder(root, rel) : root;
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { entries: [], truncated: false };
  let raw: fs.Dirent[];
  try { raw = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { entries: [], truncated: false }; }
  const kept = raw.filter((e) => !(e.isDirectory() && skip.has(e.name)) && (e.isDirectory() || e.isFile() || e.isSymbolicLink()));
  const entries: DirEntry[] = [];
  for (const e of kept.slice(0, limit)) {
    const full = path.join(dir, e.name);
    let size = 0;
    let count = 0;
    if (e.isDirectory()) { try { count = fs.readdirSync(full).length; } catch { /* unreadable */ } }
    else { try { size = fs.statSync(full).size; } catch { /* vanished mid-listing */ } }
    entries.push({ name: e.name, dir: e.isDirectory(), size, count });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries, truncated: kept.length > limit };
}

// sanitize a client relative path and resolve it under root — blocks traversal (returns null)
export function resolveUnder(root: string, rel: string): string | null {
  const clean = String(rel).split(/[/\\]/).map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').join('/');
  if (!clean) return null;
  const full = path.resolve(root, clean);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

export const IMG_CT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
};
