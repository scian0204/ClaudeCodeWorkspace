import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import { paths } from '../lib/paths.js';
import { config } from '../config.js';
import { cfg } from '../lib/config-registry.js';
import { keyFingerprint } from '../lib/secret-box.js';
import { sqlite, initDb } from '../db/index.js';
import { appVersion } from './self-update.js';
import { removeAllEditors } from '../codeserver/manager.js';
import { turnLimiter } from '../claude/throttle.js';

// Whole-workspace backup & restore (server migration). The entire state is one directory
// (config.dataDir): SQLite DB + per-user/room homes (incl. plaintext CLI credentials!) + wiki +
// brand + review clones. Backup = consistent DB snapshot (VACUUM INTO) + system-tar stream of the
// data dirs. Restore = upload tar → extract to staging → validate → swap dirs → process.exit(0)
// (docker's restart policy revives — same trick as POST /api/admin/restart).
//
// SECURITY: the archive IS a credential dump (OAuth credential files, password hashes, encrypted
// tokens). Admin-only endpoints, and the UI says to handle the file like a secret.

interface BackupMeta { version: string; createdAt: number; dataDir: string; keyFp: string }
export interface RestoreSummary {
  version: string | null; createdAt: number | null; users: number; sizeBytes: number;
  keyMatch: boolean | null;   // null = archive predates meta / meta missing
  dataDirMatch: boolean | null;
  hasReviews: boolean;
}

let backupRunning = false;
let restoreBusy = false; // upload/extract in progress — status/apply wait for it to settle

const ARCHIVE = 'archive.tgz';
const EXTRACT = 'x';
// dataDir top-level entries a backup carries. WAL sidecars (app.db-wal/-shm) are deliberately NOT
// in the archive (VACUUM INTO produces a self-contained snapshot; a stale WAL corrupts a restored DB).
const DATA_DIRS = ['common', 'users', 'rooms', 'wiki', 'brand'];

const rmrf = (p: string) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };

// boot-time reap: a crash mid-backup/upload leaves only garbage (NOT .pre-restore — that's the rollback)
export function reapBackupStaging(): void {
  rmrf(paths.backupStaging);
  rmrf(paths.restoreStaging);
}

function tarCreateArgs(stagingDb: string, includeReviews: boolean): string[] {
  const args = ['-czf', '-', '-C', stagingDb, 'app.db', 'backup-meta.json'];
  for (const d of DATA_DIRS) if (fs.existsSync(path.join(config.dataDir, d))) args.push('-C', config.dataDir, d);
  if (includeReviews && fs.existsSync(paths.reviews)) args.push('-C', config.dataDir, 'reviews');
  return args;
}

export function backupFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `ccw-backup-${appVersion()}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.tgz`;
}

// Consistent DB snapshot + streamed tar of the data dirs. Single-flight; staging cleaned on end/error.
export function createBackupStream(): NodeJS.ReadableStream {
  if (backupRunning) throw new Error('a backup is already running');
  backupRunning = true;
  try {
    rmrf(paths.backupStaging);
    fs.mkdirSync(paths.backupStaging, { recursive: true });
    const snap = path.join(paths.backupStaging, 'app.db');
    sqlite.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); // consistent under WAL, no extra dep
    const meta: BackupMeta = { version: appVersion(), createdAt: Date.now(), dataDir: config.dataDir, keyFp: keyFingerprint() };
    fs.writeFileSync(path.join(paths.backupStaging, 'backup-meta.json'), JSON.stringify(meta));
  } catch (e) { backupRunning = false; rmrf(paths.backupStaging); throw e; }

  // system tar: present in the Debian-slim image and Win10+ (bsdtar); portable flags only
  const child = spawn('tar', tarCreateArgs(paths.backupStaging, cfg.bool('backupIncludeReviews')), { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (b) => { err += b.toString(); });
  const done = () => { backupRunning = false; rmrf(paths.backupStaging); };
  child.on('close', (code) => { done(); if (code !== 0) child.stdout.emit('error', new Error(`tar exited ${code}: ${err.slice(0, 300)}`)); });
  child.on('error', (e) => { done(); child.stdout.emit('error', e); });
  return child.stdout;
}

const extractDir = () => path.join(paths.restoreStaging, EXTRACT);

function summarize(): RestoreSummary | null {
  const x = extractDir();
  const dbPath = path.join(x, 'app.db');
  if (!fs.existsSync(dbPath)) return null;
  let users = 0;
  const probe = new Database(dbPath, { readonly: true });
  try { users = (probe.prepare('SELECT count(*) AS n FROM users').get() as any).n; } finally { probe.close(); }
  let meta: BackupMeta | null = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(x, 'backup-meta.json'), 'utf8')); } catch { /* older/foreign archive */ }
  const sizeBytes = fs.existsSync(path.join(paths.restoreStaging, ARCHIVE)) ? fs.statSync(path.join(paths.restoreStaging, ARCHIVE)).size : 0;
  return {
    version: meta?.version ?? null,
    createdAt: meta?.createdAt ?? null,
    users, sizeBytes,
    keyMatch: meta ? meta.keyFp === keyFingerprint() : null,
    dataDirMatch: meta ? path.resolve(meta.dataDir) === path.resolve(config.dataDir) : null,
    hasReviews: fs.existsSync(path.join(x, 'reviews')),
  };
}

// Upload → extract → validate. Replaces any previously staged restore.
export async function stageRestore(req: any): Promise<RestoreSummary> {
  if (restoreBusy) throw new Error('a restore upload is already in progress');
  restoreBusy = true;
  try {
    rmrf(paths.restoreStaging);
    fs.mkdirSync(extractDir(), { recursive: true });
    const part = await req.file({ limits: { fileSize: cfg.int('restoreMaxMB') * 1024 * 1024 } });
    if (!part) throw new Error('no file uploaded');
    const dest = path.join(paths.restoreStaging, ARCHIVE);
    await pipeline(part.file, fs.createWriteStream(dest)); // stream to disk — archives can be GBs
    if (part.file.truncated) throw new Error(`archive too large (max ${cfg.int('restoreMaxMB')}MB)`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', ['-xzf', dest, '-C', extractDir()], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (b) => { err += b.toString(); });
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}: ${err.slice(0, 300)}`))));
      child.on('error', reject);
    });
    const summary = summarize();
    if (!summary) throw new Error('not a workspace backup (app.db missing from the archive)');
    return summary;
  } catch (e) { rmrf(paths.restoreStaging); throw e; }
  finally { restoreBusy = false; }
}

export function restoreStatus(): RestoreSummary | null {
  if (restoreBusy) return null;
  try { return summarize(); } catch { return null; }
}

export function discardRestore(): void {
  rmrf(paths.restoreStaging);
}

// Move a directory across the swap. rename is atomic-ish on the same fs (the Linux container path);
// Windows dev throws EBUSY/EPERM on dirs with open handles → copy+delete fallback.
function move(src: string, dst: string): void {
  try { fs.renameSync(src, dst); }
  catch { fs.cpSync(src, dst, { recursive: true }); rmrf(src); }
}

// Swap the staged state in and exit; docker (restart: unless-stopped) brings the server back up on
// the restored data. The previous state stays in .pre-restore as a one-shot manual rollback.
export function applyRestore(): { ok: true } {
  if (restoreBusy) throw new Error('restore upload still in progress');
  if (turnLimiter.inUse > 0) throw new Error('turns are running — wait for them to finish (Claude writes into the dirs being replaced)');
  const x = extractDir();
  if (!fs.existsSync(path.join(x, 'app.db'))) throw new Error('no staged restore');

  void removeAllEditors().catch(() => { /* editors' bind mounts point into the dirs being swapped */ });
  try { sqlite.close(); } catch { /* already closed */ }

  // previous state → .pre-restore (fresh each time)
  rmrf(paths.preRestore);
  fs.mkdirSync(paths.preRestore, { recursive: true });
  for (const entry of fs.readdirSync(config.dataDir)) {
    if (entry === '.restore-staging' || entry === '.pre-restore') continue;
    move(path.join(config.dataDir, entry), path.join(paths.preRestore, entry));
  }
  // staged state → dataDir (app.db from VACUUM INTO is self-contained; no WAL sidecars can exist here)
  for (const entry of fs.readdirSync(x)) {
    if (entry === 'backup-meta.json') continue;
    move(path.join(x, entry), path.join(config.dataDir, entry));
  }
  rmrf(paths.restoreStaging);
  // reopen the DB just long enough for the response to go out; the process exits right after anyway
  try { initDb(); } catch { /* the restart re-runs initDb from scratch */ }
  setTimeout(() => { console.log('[ccw] restore applied — restarting'); process.exit(0); }, 300);
  return { ok: true };
}
