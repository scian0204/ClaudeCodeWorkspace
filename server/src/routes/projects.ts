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
import {
  gitStatus, gitCommit, gitPush, originHost, gitBranches, gitCheckout, gitFetchRemotes,
  gitInit, gitHasCommits, gitSetOrigin, isRepo,
} from '../lib/git-ops.js';
import { createRemoteRepo, safeRepoName } from '../lib/git-publish.js';
import { cfg } from '../lib/config-registry.js';
import {
  resolveGitCred, resolveGitCredById, resolveGitCredMeta, getGitCredRow, gitIdentity, askpassEnv, identityEnv, hostFromGitUrl,
} from '../auth/git-cred.js';

const execFileP = promisify(execFile);

function safeName(n: string) {
  // Charset keeps '.', so guard all-dots (e.g. '..') which would path.join up to the parent dir.
  const s = String(n).replace(/[^a-zA-Z0-9._ -]/g, '').trim();
  return !s || /^\.+$/.test(s) ? 'project' : s;
}

// only http(s)/git/ssh remotes — no file:// (local-fs exfil) or other schemes
function validGitUrl(url: string) {
  return /^https?:\/\/\S+$/.test(url) || /^git:\/\/\S+$/.test(url) || /^ssh:\/\/\S+$/.test(url) || /^git@[^\s:]+:.+$/.test(url);
}
function repoNameFromUrl(url: string) {
  const last = url.replace(/\.git$/, '').replace(/[\/]+$/, '').split(/[\/:]/).pop() || 'repo';
  return safeName(last);
}
async function cloneRepo(url: string, dir: string, credEnv?: Record<string, string>, branch?: string) {
  // Full clone: complete history + every branch (so git log/blame and `git branch -r` all work).
  // `branch` (validated by caller) checks out that ref after clone; still fetches all branches.
  // Without a credential the prompt is disabled so private repos fail fast; with one, credEnv
  // supplies GIT_ASKPASS + GIT_CRED_* so the token authenticates (never placed in the URL).
  await execFileP('git', ['clone', ...(branch ? ['--branch', branch] : []), url, dir], {
    timeout: 180_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/echo', ...(credEnv || {}) },
  });
}

// Typed error so both the HTTP route and the member-request action map failures to the same status
// codes / messages (route → reply.code(status); request → surfaced via `result`).
export class ProjectError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface ProjectInput { scope?: string; name?: string; roomId?: string; gitUrl?: string; branch?: string; credentialId?: string; }

// Validate git URL + branch + (when a credential is picked) its ownership and host binding — the exact
// checks the admin route ran inline. No side effects (no token decrypt, no fs), so it's safe to call at
// member-request SUBMIT time; createProject re-runs it at approval/EXECUTE time (defense in depth: the
// requester's creds/roles may have changed in between). Throws ProjectError on any invalid input.
export function validateProjectInput(input: ProjectInput, user: AuthUser): void {
  const git = input.gitUrl ? String(input.gitUrl).trim() : '';
  if (git && !validGitUrl(git)) throw new ProjectError(400, '지원하지 않는 저장소 URL (http/https/git/ssh만 가능)');
  // Branch goes into `git clone --branch <br>` argv. execFile (no shell) blocks injection, but a
  // leading '-' would still be parsed as an option, so restrict to safe ref chars, no leading '-'.
  const br = input.branch ? String(input.branch).trim() : '';
  if (br && !/^(?!-)[\w./-]+$/.test(br)) throw new ProjectError(400, '잘못된 브랜치 이름');
  if (git && input.credentialId) {
    const row = getGitCredRow(String(input.credentialId));
    if (!row) throw new ProjectError(404, 'credential not found');
    if (!(row.scope === 'common' || (row.scope === 'user' && row.ownerId === user.id)))
      throw new ProjectError(403, 'forbidden credential');
    // host binding: never send a stored token to a different host than it belongs to (else a caller
    // could exfiltrate a PAT to an attacker-controlled clone URL).
    if (row.host !== hostFromGitUrl(git))
      throw new ProjectError(400, 'credential host does not match repository URL');
  }
}

// Create a project with an optional git clone. Shared by the admin route and the member-request
// approval (admin/requests.ts `common_project`), so approval performs the SAME clone/validation the
// admin route would, resolving the credential AS `user`. NOTE: the `scope==='common'` admin gate lives
// in the route handler, NOT here — approval intentionally creates a common project for a member.
export async function createProject(input: ProjectInput, user: AuthUser): Promise<typeof schema.projects.$inferSelect> {
  validateProjectInput(input, user);
  const git = input.gitUrl ? String(input.gitUrl).trim() : '';
  const br = input.branch ? String(input.branch).trim() : '';
  // Resolve a clone credential: explicit pick (already ownership/host-checked above), else auto by host.
  let cloneEnv: Record<string, string> | undefined;
  if (git) {
    const cred = input.credentialId ? resolveGitCredById(String(input.credentialId)) : resolveGitCred(user.id, hostFromGitUrl(git));
    if (cred) cloneEnv = askpassEnv(cred);
  }
  const nm = safeName(input.name || (git ? repoNameFromUrl(git) : ''));
  let dir: string, ownerId: string | null;
  if (input.scope === 'common') {
    dir = path.join(paths.commonProjects, nm); ownerId = null;
  } else if (input.scope === 'room') {
    if (user.role !== 'admin' && !rooms.isMember(String(input.roomId), user.id)) throw new ProjectError(403, 'forbidden');
    dir = path.join(paths.roomProjects(String(input.roomId)), nm); ownerId = String(input.roomId);
  } else {
    dir = path.join(paths.userProjects(user.id), nm); ownerId = user.id;
  }
  if (git) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new ProjectError(409, `이미 존재하는 이름: ${nm}`);
    ensure(path.dirname(dir));
    try {
      await cloneRepo(git, dir, cloneEnv, br || undefined);
    } catch (e: any) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
      throw new ProjectError(500, `git clone 실패: ${String(e?.stderr || e?.message || e).slice(0, 300)}`);
    }
  } else {
    ensure(dir);
  }
  const row = { id: newId(), scope: input.scope || 'user', ownerId, name: nm, path: dir, createdAt: Date.now() };
  db.insert(schema.projects).values(row).run();
  return row;
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
    const body = (req.body || {}) as ProjectInput;
    // Members reach a common project ONLY through an approved member-request (admin/requests.ts);
    // the direct route stays admin-only. createProject itself does NOT gate common (approval creates
    // one for a member on purpose), so the gate must live here.
    if (body.scope === 'common' && !requireAdmin(req, reply)) return;
    try {
      const row = await createProject(body, u);
      return { project: row };
    } catch (e: any) {
      const status = e instanceof ProjectError ? e.status : 500;
      return reply.code(status).send({ error: String(e?.message || e) });
    }
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

  // ── publish: take an untracked project (an import lands as plain files) all the way to a remote ──
  // Split in two so the cheap half stands alone: init just makes it a repo, publish does the whole
  // init → first commit → create remote → push chain. Both are no-ops on the parts already done.

  // Resolve the credential the caller picked, enforcing ownership. Common creds are shared, user
  // creds are only ever the caller's own — never trust an id straight from the body.
  function credFor(u: AuthUser, id: string) {
    const row = getGitCredRow(String(id || ''));
    if (!row) return null;
    if (row.scope === 'user' && row.ownerId !== u.id) return null;
    const resolved = resolveGitCredById(row.id);
    return resolved ? { row, cred: resolved } : null;
  }

  app.post('/api/projects/:id/git/init', async (req, reply) => {
    const ctx = loadForGit(req, reply); if (!ctx) return;
    if (!cfg.bool('gitPublishEnabled')) return reply.code(403).send({ error: 'git publish is disabled' });
    if (await isRepo(ctx.dir)) return reply.code(400).send({ error: 'already a git repository' });
    const { message } = (req.body || {}) as any;
    const ident = gitIdentity({ username: ctx.u.username, displayName: ctx.u.displayName }, null);
    try {
      await gitInit(ctx.dir, cfg.str('gitInitBranch'));
      // an empty dir has nothing to commit — leave the repo unborn rather than failing the call
      const st = await gitStatus(ctx.dir);
      if (st.files.length) {
        await gitCommit(ctx.dir, { message: String(message || 'Initial commit'), env: identityEnv(ident) });
      }
      return { ok: true, ...(await gitStatus(ctx.dir)) };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
  });

  app.post('/api/projects/:id/git/publish', async (req, reply) => {
    const ctx = loadForGit(req, reply); if (!ctx) return;
    if (!cfg.bool('gitPublishEnabled')) return reply.code(403).send({ error: 'git publish is disabled' });
    const b = (req.body || {}) as any;
    const remoteUrl = String(b.remoteUrl || '').trim();

    // The credential does double duty: it authenticates the create-repo API call and the push.
    // With a pasted URL we still need one, resolved by that URL's host.
    const picked = b.credentialId ? credFor(ctx.u, b.credentialId) : null;
    if (b.credentialId && !picked) return reply.code(403).send({ error: 'credential not found' });
    // creating the repo needs a provider to create it on — only a pasted URL can go without one
    if (!picked && !remoteUrl) return reply.code(400).send({ error: 'pick a credential, or paste a repository URL' });
    const host = picked?.row.host || (remoteUrl ? hostFromGitUrl(remoteUrl) : null);
    const cred = picked?.cred || (host ? resolveGitCred(ctx.u.id, host) : null);
    if (!cred) return reply.code(400).send({ error: `${host || 'this host'} 자격증명이 없습니다 — 설정에서 등록하세요` });

    const ident = gitIdentity({ username: ctx.u.username, displayName: ctx.u.displayName }, cred);
    try {
      await gitInit(ctx.dir, cfg.str('gitInitBranch'));
      if (!(await gitHasCommits(ctx.dir))) {
        const st = await gitStatus(ctx.dir);
        if (!st.files.length) return reply.code(400).send({ error: 'nothing to publish — the project is empty' });
        await gitCommit(ctx.dir, { message: String(b.message || 'Initial commit'), env: identityEnv(ident) });
      }
      // Create the repo only when the user did not bring their own URL. Ordering matters: the
      // remote is wired up after creation succeeds, so a failed create leaves origin untouched.
      const url = remoteUrl || await createRemoteRepo(
        { provider: picked!.row.provider as any, host: picked!.row.host, username: cred.username, token: cred.token },
        { name: safeRepoName(b.name || ctx.p.name), private: b.private !== false },
      );
      await gitSetOrigin(ctx.dir, url);
      const { output } = await gitPush(ctx.dir, { env: askpassEnv(cred) });
      return { ok: true, url, output, ...(await gitStatus(ctx.dir)) };
    } catch (e: any) { return reply.code(400).send({ error: String(e?.message || e) }); }
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
