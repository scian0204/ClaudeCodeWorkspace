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
