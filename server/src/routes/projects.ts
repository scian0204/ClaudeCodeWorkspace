import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireAuth, requireAdmin, type AuthUser } from '../auth/index.js';
import { paths, ensure } from '../lib/paths.js';
import { newId } from '../lib/ids.js';
import * as rooms from '../rooms/manager.js';
import * as cs from '../codeserver/manager.js';

const execFileP = promisify(execFile);

function safeName(n: string) { return String(n).replace(/[^a-zA-Z0-9._ -]/g, '').trim() || 'project'; }

// only http(s)/git/ssh remotes — no file:// (local-fs exfil) or other schemes
function validGitUrl(url: string) {
  return /^https?:\/\/\S+$/.test(url) || /^git:\/\/\S+$/.test(url) || /^ssh:\/\/\S+$/.test(url) || /^git@[^\s:]+:.+$/.test(url);
}
function repoNameFromUrl(url: string) {
  const last = url.replace(/\.git$/, '').replace(/[\/]+$/, '').split(/[\/:]/).pop() || 'repo';
  return safeName(last);
}
async function cloneRepo(url: string, dir: string) {
  // shallow, no credential prompt (private repos fail fast instead of hanging)
  await execFileP('git', ['clone', '--depth', '1', url, dir], {
    timeout: 180_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/echo' },
  });
}

function canAccess(u: AuthUser, p: NonNullable<ReturnType<typeof getProject>>): boolean {
  if (u.role === 'admin') return true;
  if (p.scope === 'common') return true;
  if (p.scope === 'user') return p.ownerId === u.id;
  if (p.scope === 'room') return rooms.isMember(p.ownerId!, u.id);
  return false;
}
function getProject(id: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
}

type FileItem = { name: string; size: number };

// dirs never worth showing in the explorer (bloat / vcs / build output)
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'out', '.venv', 'venv',
  '__pycache__', '.cache', 'vendor', 'target', '.idea', '.gradle', '.turbo', 'coverage']);
const MAX_FILES = 5000; // cap tree size so huge repos don't hang the client

// recursively list files (root-relative paths + sizes), skipping bloat dirs, depth+count capped
function walkProject(dir: string, base = '', out: FileItem[] = [], depth = 0): FileItem[] {
  if (depth > 14 || out.length >= MAX_FILES || !fs.existsSync(dir)) return out;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkProject(path.join(dir, e.name), base ? `${base}/${e.name}` : e.name, out, depth + 1); }
    else if (e.isFile()) { let size = 0; try { size = fs.statSync(path.join(dir, e.name)).size; } catch { /* noop */ } out.push({ name: base ? `${base}/${e.name}` : e.name, size }); }
  }
  return out;
}

// sanitize a client relative path and resolve it under root — blocks traversal (returns null)
function resolveInProject(root: string, rel: string): string | null {
  const clean = String(rel).split(/[/\\]/).map((s) => s.trim()).filter((s) => s && s !== '.' && s !== '..').join('/');
  if (!clean) return null;
  const full = path.resolve(root, clean);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

const IMG_CT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
};

export async function projectRoutes(app: FastifyInstance) {
  app.get('/api/projects', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const common = db.select().from(schema.projects).where(eq(schema.projects.scope, 'common')).all();
    const mine = db.select().from(schema.projects)
      .where(and(eq(schema.projects.scope, 'user'), eq(schema.projects.ownerId, u.id))).all();
    return { common, mine };
  });

  app.get('/api/projects/room/:roomId', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { roomId } = req.params as any;
    if (u.role !== 'admin' && !rooms.isMember(roomId, u.id)) return reply.code(403).send({ error: 'forbidden' });
    const list = db.select().from(schema.projects)
      .where(and(eq(schema.projects.scope, 'room'), eq(schema.projects.ownerId, roomId))).all();
    return { projects: list };
  });

  app.post('/api/projects', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { scope, name, roomId, gitUrl } = (req.body || {}) as any;
    const git = gitUrl ? String(gitUrl).trim() : '';
    if (git && !validGitUrl(git)) return reply.code(400).send({ error: '지원하지 않는 저장소 URL (http/https/git/ssh만 가능)' });
    const nm = safeName(name || (git ? repoNameFromUrl(git) : ''));
    let dir: string, ownerId: string | null;
    if (scope === 'common') {
      if (!requireAdmin(req, reply)) return;
      dir = path.join(paths.commonProjects, nm); ownerId = null;
    } else if (scope === 'room') {
      if (u.role !== 'admin' && !rooms.isMember(roomId, u.id)) return reply.code(403).send({ error: 'forbidden' });
      dir = path.join(paths.roomProjects(roomId), nm); ownerId = roomId;
    } else {
      dir = path.join(paths.userProjects(u.id), nm); ownerId = u.id;
    }
    if (git) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length) return reply.code(409).send({ error: `이미 존재하는 이름: ${nm}` });
      ensure(path.dirname(dir));
      try {
        await cloneRepo(git, dir);
      } catch (e: any) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
        return reply.code(500).send({ error: `git clone 실패: ${String(e?.stderr || e?.message || e).slice(0, 300)}` });
      }
    } else {
      ensure(dir);
    }
    const row = { id: newId(), scope: scope || 'user', ownerId, name: nm, path: dir, createdAt: Date.now() };
    db.insert(schema.projects).values(row).run();
    return { project: row };
  });

  app.post('/api/projects/:id/open-editor', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const p = getProject(id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canAccess(u, p)) return reply.code(403).send({ error: 'forbidden' });
    if (!cs.dockerAvailable()) return reply.code(501).send({ error: 'code-server unavailable — run via Docker deployment' });
    try {
      const { url } = await cs.open(u.id, p.id, p.path);
      return { url };
    } catch (e: any) {
      return reply.code(500).send({ error: String(e?.message || e) });
    }
  });

  // file tree of a project (paths + sizes only) — for the chat file explorer
  app.get('/api/projects/:id/tree', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = getProject((req.params as any).id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canAccess(u, p)) return reply.code(403).send({ error: 'forbidden' });
    return { files: walkProject(path.resolve(p.path)) };
  });

  // one file's text content — ?path=<relative>
  app.get('/api/projects/:id/file', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = getProject((req.params as any).id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canAccess(u, p)) return reply.code(403).send({ error: 'forbidden' });
    const full = resolveInProject(path.resolve(p.path), String((req.query as any).path || ''));
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return reply.code(404).send({ error: 'not found' });
    const st = fs.statSync(full);
    if (st.size > 500_000) return { name: full, size: st.size, content: `(파일이 큽니다: ${st.size} bytes — 생략)` };
    const buf = fs.readFileSync(full);
    const content = buf.includes(0) ? '(바이너리 파일 — 미리보기 없음)' : buf.toString('utf8');
    return { name: full, size: st.size, content };
  });

  // raw file bytes — for <img> preview; ?path=<relative>
  app.get('/api/projects/:id/blob', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = getProject((req.params as any).id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canAccess(u, p)) return reply.code(403).send({ error: 'forbidden' });
    const full = resolveInProject(path.resolve(p.path), String((req.query as any).path || ''));
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return reply.code(404).send({ error: 'not found' });
    const ext = (full.split('.').pop() || '').toLowerCase();
    reply.header('Content-Type', IMG_CT[ext] || 'application/octet-stream');
    reply.header('Cache-Control', 'private, max-age=60');
    return reply.send(fs.createReadStream(full));
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const { id } = req.params as any;
    const p = getProject(id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (p.scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if (p.scope === 'user' && p.ownerId !== u.id && u.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    // only removes the DB index entry; files remain on the volume (safe)
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
    return { ok: true };
  });
}
