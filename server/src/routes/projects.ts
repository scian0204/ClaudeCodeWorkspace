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
import { walkFiles, resolveUnder, IMG_CT } from '../lib/filetree.js';
import * as rooms from '../rooms/manager.js';
import * as cs from '../codeserver/manager.js';
import { gitStatus, gitCommit, gitPush, originHost, gitBranches, gitCheckout, gitFetchRemotes } from '../lib/git-ops.js';
import {
  resolveGitCred, resolveGitCredById, resolveGitCredMeta, getGitCredRow, gitIdentity, askpassEnv, identityEnv, hostFromGitUrl,
} from '../auth/git-cred.js';

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
async function cloneRepo(url: string, dir: string, credEnv?: Record<string, string>) {
  // shallow. Without a credential the prompt is disabled so private repos fail fast; with one,
  // credEnv supplies GIT_ASKPASS + GIT_CRED_* so the token authenticates (never placed in the URL).
  // --no-single-branch: still shallow (depth 1) but fetch every branch tip, so `git branch -r`
  // lists all remote branches (else --depth implies --single-branch → only the default branch).
  await execFileP('git', ['clone', '--depth', '1', '--no-single-branch', url, dir], {
    timeout: 180_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/echo', ...(credEnv || {}) },
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
    const { scope, name, roomId, gitUrl, credentialId } = (req.body || {}) as any;
    const git = gitUrl ? String(gitUrl).trim() : '';
    if (git && !validGitUrl(git)) return reply.code(400).send({ error: '지원하지 않는 저장소 URL (http/https/git/ssh만 가능)' });
    // Resolve a clone credential: explicit pick (must be the user's own or a common one), else auto by host.
    let cloneEnv: Record<string, string> | undefined;
    if (git) {
      let cred = null;
      if (credentialId) {
        const row = getGitCredRow(String(credentialId));
        if (!row) return reply.code(404).send({ error: 'credential not found' });
        if (!(row.scope === 'common' || (row.scope === 'user' && row.ownerId === u.id)))
          return reply.code(403).send({ error: 'forbidden credential' });
        // host binding: never send a stored token to a different host than it belongs to
        // (else a caller could exfiltrate a PAT to an attacker-controlled clone URL).
        if (row.host !== hostFromGitUrl(git))
          return reply.code(400).send({ error: 'credential host does not match repository URL' });
        cred = resolveGitCredById(String(credentialId));
      } else {
        cred = resolveGitCred(u.id, hostFromGitUrl(git));
      }
      if (cred) cloneEnv = askpassEnv(cred);
    }
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
        await cloneRepo(git, dir, cloneEnv);
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
    return { files: walkFiles(path.resolve(p.path)) };
  });

  // one file's text content — ?path=<relative>
  app.get('/api/projects/:id/file', async (req, reply) => {
    const u = requireAuth(req, reply); if (!u) return;
    const p = getProject((req.params as any).id);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (!canAccess(u, p)) return reply.code(403).send({ error: 'forbidden' });
    const full = resolveUnder(path.resolve(p.path), String((req.query as any).path || ''));
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
    const full = resolveUnder(path.resolve(p.path), String((req.query as any).path || ''));
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
    if (!canAccess(u, p)) return reply.code(403).send({ error: 'forbidden' });
    if (p.scope === 'common' && u.role !== 'admin') return reply.code(403).send({ error: 'admin only' });
    if (p.scope === 'user' && p.ownerId !== u.id && u.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    // remove the working dir too, but ONLY if it resolves strictly inside the scope's projects
    // root (guard against a stray/absolute path deleting something outside the volume layout).
    const root = path.resolve(
      p.scope === 'common' ? paths.commonProjects
        : p.scope === 'room' ? paths.roomProjects(p.ownerId!)
          : paths.userProjects(p.ownerId!));
    const dir = path.resolve(p.path);
    if (dir !== root && dir.startsWith(root + path.sep)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort: keep going, still unindex */ }
    }
    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();
    return { ok: true };
  });

  // ── git: status / commit / push on the project's working dir ──
  // Loads the project and enforces access; returns null after replying on failure.
  function loadForGit(req: any, reply: any) {
    const u = requireAuth(req, reply); if (!u) return null;
    const p = getProject((req.params as any).id);
    if (!p) { reply.code(404).send({ error: 'not found' }); return null; }
    if (!canAccess(u, p)) { reply.code(403).send({ error: 'forbidden' }); return null; }
    return { u, p, dir: path.resolve(p.path) };
  }

  app.get('/api/projects/:id/git/status', async (req, reply) => {
    const ctx = loadForGit(req, reply); if (!ctx) return;
    const st = await gitStatus(ctx.dir);
    const host = st.repo ? await originHost(ctx.dir) : null;
    // Which credential this repo's push/commit actually resolves to (meta only — token never sent),
    // plus the identity commits will be attributed to. Powers the "credential in effect" panel.
    const credential = host ? resolveGitCredMeta(ctx.u.id, host) : null;
    const cred = host ? resolveGitCred(ctx.u.id, host) : null;
    const identity = gitIdentity({ username: ctx.u.username, displayName: ctx.u.displayName }, cred);
    return { ...st, host, credential, hasCredential: !!credential, identity };
  });

  app.post('/api/projects/:id/git/commit', async (req, reply) => {
    const ctx = loadForGit(req, reply); if (!ctx) return;
    const { message, files } = (req.body || {}) as any;
    if (!message || !String(message).trim()) return reply.code(400).send({ error: 'commit message required' });
    const host = await originHost(ctx.dir);
    const cred = host ? resolveGitCred(ctx.u.id, host) : null;
    const ident = gitIdentity({ username: ctx.u.username, displayName: ctx.u.displayName }, cred);
    try {
      const { commit } = await gitCommit(ctx.dir, {
        message: String(message), files: Array.isArray(files) ? files.map(String) : undefined,
        env: identityEnv(ident),
      });
      return { ok: true, commit };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.post('/api/projects/:id/git/push', async (req, reply) => {
    const ctx = loadForGit(req, reply); if (!ctx) return;
    const host = await originHost(ctx.dir);
    if (!host) return reply.code(400).send({ error: 'origin remote 없음 — 푸시할 원격지가 없습니다' });
    const cred = resolveGitCred(ctx.u.id, host);
    if (!cred) return reply.code(400).send({ error: `${host} 자격증명이 없습니다 — 설정에서 등록하세요` });
    try {
      const { output } = await gitPush(ctx.dir, { env: askpassEnv(cred) });
      return { ok: true, output };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.get('/api/projects/:id/git/branches', async (req, reply) => {
    const ctx = loadForGit(req, reply); if (!ctx) return;
    // refresh remote refs first so pre-existing single-branch clones also list every remote branch
    const host = await originHost(ctx.dir);
    const cred = host ? resolveGitCred(ctx.u.id, host) : null;
    await gitFetchRemotes(ctx.dir, cred ? askpassEnv(cred) : undefined);
    return await gitBranches(ctx.dir);
  });

  app.post('/api/projects/:id/git/checkout', async (req, reply) => {
    const ctx = loadForGit(req, reply); if (!ctx) return;
    const { branch } = (req.body || {}) as any;
    if (!branch || !String(branch).trim()) return reply.code(400).send({ error: 'branch required' });
    try {
      const r = await gitCheckout(ctx.dir, { branch: String(branch) });
      return { ok: true, branch: r.branch };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });
}
