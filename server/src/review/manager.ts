import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { paths, ensure } from '../lib/paths.js';
import { config } from '../config.js';
import { getUserById, findByUsername, type AuthUser } from '../auth/index.js';
import {
  gitCloneFull, gitFetch, gitFetchRemotes, gitWorktreeAdd, gitWorktreeRemove, gitResetHard, gitMerge,
} from '../lib/git-ops.js';
import {
  resolveGitCredById, getGitCredRow, askpassEnv, identityEnv, gitIdentity, hostFromGitUrl,
} from '../auth/git-cred.js';
import {
  inferProvider, slugFromUrl, listPulls, prHeadFetch, prLocalRef, type ReviewProvider, type PullInfo,
} from './providers.js';

type Repo = typeof schema.reviewRepos.$inferSelect;
type Review = typeof schema.reviewSessions.$inferSelect;

// "lists changed" ping to all connected sockets — registered by realtime init to avoid an
// io<->manager import cycle (same pattern as the queue's emit factory).
let notify: () => void = () => {};
export function setReviewBroadcast(fn: () => void) { notify = fn; }

export function getRepo(id: string) {
  return db.select().from(schema.reviewRepos).where(eq(schema.reviewRepos.id, id)).get();
}
export function listRepos() {
  return db.select().from(schema.reviewRepos).orderBy(desc(schema.reviewRepos.createdAt)).all();
}
export function getReview(id: string) {
  return db.select().from(schema.reviewSessions).where(eq(schema.reviewSessions.id, id)).get();
}
export function getReviewByChat(chatSessionId: string) {
  return db.select().from(schema.reviewSessions).where(eq(schema.reviewSessions.chatSessionId, chatSessionId)).get();
}

// ── repo lifecycle ──
export async function createRepo(admin: AuthUser, p: {
  name?: string; gitUrl: string; credentialId: string; provider?: string; baseBranch?: string;
}): Promise<Repo> {
  const gitUrl = (p.gitUrl || '').trim();
  const host = hostFromGitUrl(gitUrl);
  if (!host) throw new Error('원격지 URL에서 호스트를 해석할 수 없습니다');
  const slug = slugFromUrl(gitUrl);
  if (!slug) throw new Error('원격지 URL에서 저장소 경로를 해석할 수 없습니다');
  const credRow = getGitCredRow(p.credentialId);
  if (!credRow) throw new Error('자격증명을 찾을 수 없습니다');
  if (!(credRow.scope === 'common' || (credRow.scope === 'user' && credRow.ownerId === admin.id)))
    throw new Error('사용할 수 없는 자격증명입니다');
  // host binding: never send a stored token to a host it doesn't belong to
  if (credRow.host !== host) throw new Error('자격증명 호스트가 저장소 URL과 일치하지 않습니다');
  const cred = resolveGitCredById(p.credentialId);
  if (!cred) throw new Error('자격증명 복호화 실패');
  const provider = inferProvider(host, p.provider || credRow.provider);

  const id = newId();
  const dir = paths.reviewRepo(id);
  ensure(paths.reviewRoot(id));
  try {
    await gitCloneFull(gitUrl, dir, askpassEnv(cred));
  } catch (e: any) {
    try { fs.rmSync(paths.reviewRoot(id), { recursive: true, force: true }); } catch { /* noop */ }
    throw new Error(`git clone 실패: ${String(e?.stderr || e?.message || e).slice(0, 300)}`);
  }
  const now = Date.now();
  const row: Repo = {
    id, name: (p.name || slug).trim(), provider, host, gitUrl, slug, credentialId: p.credentialId,
    path: dir, baseBranch: p.baseBranch?.trim() || null, createdBy: admin.id, createdAt: now,
    polledAt: null, pollError: null,
  };
  db.insert(schema.reviewRepos).values(row).run();
  await pollRepo(id).catch(() => { /* error recorded on the row */ });
  return getRepo(id)!;
}

export function deleteRepo(id: string) {
  const repo = getRepo(id); if (!repo) return;
  const rows = db.select().from(schema.reviewSessions).where(eq(schema.reviewSessions.repoId, id)).all();
  for (const rv of rows) {
    db.delete(schema.messages).where(eq(schema.messages.sessionId, rv.chatSessionId)).run();
    db.delete(schema.chatSessions).where(eq(schema.chatSessions.id, rv.chatSessionId)).run();
  }
  db.delete(schema.reviewSessions).where(eq(schema.reviewSessions.repoId, id)).run();
  db.delete(schema.reviewRepos).where(eq(schema.reviewRepos.id, id)).run();
  const root = path.resolve(paths.reviewRoot(id));
  if (root.startsWith(path.resolve(paths.reviews) + path.sep)) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  notify();
}

export function deleteReview(rv: Review) {
  const repo = getRepo(rv.repoId);
  if (repo && rv.worktreePath) void gitWorktreeRemove(repo.path, rv.worktreePath);
  db.delete(schema.messages).where(eq(schema.messages.sessionId, rv.chatSessionId)).run();
  db.delete(schema.chatSessions).where(eq(schema.chatSessions.id, rv.chatSessionId)).run();
  db.delete(schema.reviewSessions).where(eq(schema.reviewSessions.id, rv.id)).run();
  notify();
}

// ── polling ──
const polling = new Set<string>();

function matchAuthor(login: string): string | null {
  if (!login) return null;
  const exact = findByUsername(login);
  if (exact) return exact.id;
  const ci = db.select().from(schema.users).all().find((x) => x.username.toLowerCase() === login.toLowerCase());
  return ci?.id ?? null;
}

// Create or refresh the review session for a PR. Returns true if a NEW session was created.
function upsertReview(repo: Repo, pr: PullInfo): boolean {
  const now = Date.now();
  const authorUserId = matchAuthor(pr.authorLogin);
  const existing = db.select().from(schema.reviewSessions)
    .where(and(eq(schema.reviewSessions.repoId, repo.id), eq(schema.reviewSessions.prNumber, pr.number))).get();
  if (existing) {
    db.update(schema.reviewSessions).set({
      prTitle: pr.title, prUrl: pr.url, prState: 'open', baseRef: pr.baseRef, headRef: pr.headRef,
      headSha: pr.headSha, headCloneUrl: pr.headCloneUrl, authorLogin: pr.authorLogin,
      authorUserId: authorUserId ?? existing.authorUserId, updatedAt: now,
    }).where(eq(schema.reviewSessions.id, existing.id)).run();
    db.update(schema.chatSessions).set({ title: `#${pr.number} ${pr.title}` })
      .where(eq(schema.chatSessions.id, existing.chatSessionId)).run();
    return false;
  }
  const chatSessionId = newId();
  db.insert(schema.chatSessions).values({
    id: chatSessionId, ownerId: repo.createdBy, kind: 'review', roomId: null,
    title: `#${pr.number} ${pr.title}`, projectId: null, wikiTopicId: null, claudeSessionId: null,
    model: 'claude-opus-4-8', permissionMode: 'default', createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.reviewSessions).values({
    id: newId(), repoId: repo.id, chatSessionId, prNumber: pr.number, prTitle: pr.title, prUrl: pr.url,
    prState: 'open', authorLogin: pr.authorLogin, authorUserId, baseRef: pr.baseRef, headRef: pr.headRef,
    headSha: pr.headSha, headCloneUrl: pr.headCloneUrl, worktreePath: null, mergeState: 'none',
    mergedAt: null, createdAt: now, updatedAt: now,
  }).run();
  return true;
}

export async function pollRepo(id: string): Promise<{ opened: number; closed: number }> {
  if (polling.has(id)) return { opened: 0, closed: 0 };
  polling.add(id);
  try {
    const repo = getRepo(id);
    if (!repo) return { opened: 0, closed: 0 };
    const cred = resolveGitCredById(repo.credentialId);
    if (!cred) throw new Error('자격증명 없음/복호화 실패 — 설정에서 다시 등록하세요');
    const env = askpassEnv(cred);
    await gitFetchRemotes(repo.path, env); // refresh remote refs so merges see the latest state
    const pulls = await listPulls(repo.provider as ReviewProvider, repo.host, repo.slug, {
      username: cred.username, token: cred.token,
    });
    const openNums = new Set(pulls.map((p) => p.number));
    let opened = 0;
    for (const pr of pulls) if (upsertReview(repo, pr)) opened++;
    let closed = 0;
    for (const rv of db.select().from(schema.reviewSessions).where(eq(schema.reviewSessions.repoId, id)).all()) {
      if (rv.prState === 'open' && !openNums.has(rv.prNumber)) {
        db.update(schema.reviewSessions).set({ prState: 'closed', updatedAt: Date.now() })
          .where(eq(schema.reviewSessions.id, rv.id)).run();
        closed++;
      }
    }
    db.update(schema.reviewRepos).set({ polledAt: Date.now(), pollError: null }).where(eq(schema.reviewRepos.id, id)).run();
    if (opened || closed) notify();
    return { opened, closed };
  } catch (e: any) {
    db.update(schema.reviewRepos).set({ pollError: String(e?.message || e).slice(0, 300), polledAt: Date.now() })
      .where(eq(schema.reviewRepos.id, id)).run();
    notify();
    throw e;
  } finally { polling.delete(id); }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startReviewPoller() {
  const ms = config.reviewPollMs;
  if (timer || ms <= 0) return;
  const tick = async () => { for (const r of listRepos()) { try { await pollRepo(r.id); } catch { /* on row */ } } };
  timer = setInterval(() => { void tick(); }, ms);
  setTimeout(() => { void tick(); }, 5000); // one shortly after boot
}

// ── worktree + local merge ──
// Lazily create the per-PR worktree (detached at origin/<base>). Returns its path, or the clone
// root as a fallback so a turn always has a valid cwd even if the worktree can't be created.
export async function ensureWorktree(rv: Review): Promise<string> {
  const repo = getRepo(rv.repoId);
  if (!repo) return paths.reviews;
  const wt = paths.reviewWorktree(repo.id, rv.prNumber);
  if (rv.worktreePath === wt && fs.existsSync(wt)) return wt;
  const cred = resolveGitCredById(repo.credentialId);
  const env = cred ? askpassEnv(cred) : undefined;
  ensure(paths.reviewWorktrees(repo.id));
  await gitWorktreeRemove(repo.path, wt); // clear any stale/partial worktree at this path
  const base = rv.baseRef || repo.baseBranch || 'HEAD';
  try {
    try { await gitWorktreeAdd(repo.path, wt, `origin/${base}`, env); }
    catch { await gitWorktreeAdd(repo.path, wt, base, env); }
  } catch { return repo.path; }
  db.update(schema.reviewSessions).set({ worktreePath: wt, updatedAt: Date.now() })
    .where(eq(schema.reviewSessions.id, rv.id)).run();
  return wt;
}

// Fetch the PR head, reset the worktree to the freshest base, then merge (no-ff). Conflicts are
// left in the working tree for review (mergeState='conflict'), not treated as an error.
export async function localMerge(rv: Review): Promise<{ mergeState: string; output: string }> {
  const repo = getRepo(rv.repoId);
  if (!repo) throw new Error('repo not found');
  const cred = resolveGitCredById(repo.credentialId);
  const env = cred ? askpassEnv(cred) : undefined;
  const wt = await ensureWorktree(rv);
  if (wt === repo.path) throw new Error('워크트리를 만들 수 없습니다 (clone/base 확인)');

  const pr: PullInfo = {
    number: rv.prNumber, title: rv.prTitle, url: rv.prUrl, authorLogin: rv.authorLogin,
    baseRef: rv.baseRef, headRef: rv.headRef, headSha: rv.headSha, headCloneUrl: rv.headCloneUrl,
  };
  const localRef = prLocalRef(rv.prNumber);
  const spec = prHeadFetch(repo.provider as ReviewProvider, pr);
  try {
    if (spec) await gitFetch(repo.path, ['origin', spec.refspec], env);
    else await gitFetch(repo.path, [rv.headCloneUrl!, `${rv.headRef}:${localRef}`], env); // bitbucket fork
  } catch (e: any) { throw new Error(`PR head fetch 실패: ${String(e?.message || e).slice(0, 300)}`); }

  const base = rv.baseRef || repo.baseBranch || 'HEAD';
  const user = getUserById(repo.createdBy);
  const ident = gitIdentity({ username: user?.username || 'ccw', displayName: user?.displayName || 'CCW Review' }, cred);
  const identEnv = identityEnv(ident);
  try { await gitResetHard(wt, `origin/${base}`, identEnv); }
  catch { await gitResetHard(wt, base, identEnv).catch(() => { /* keep current HEAD */ }); }
  const res = await gitMerge(wt, localRef, `Merge PR #${rv.prNumber}: ${rv.prTitle}`, identEnv);
  const mergeState = res.ok ? 'merged' : (res.conflict ? 'conflict' : 'none');
  db.update(schema.reviewSessions).set({
    mergeState, mergedAt: res.ok ? Date.now() : null, updatedAt: Date.now(),
  }).where(eq(schema.reviewSessions.id, rv.id)).run();
  notify();
  return { mergeState, output: res.output };
}

// ── visibility ──
export type ReviewRole = 'admin' | 'reader'; // null = no access; 'reader' = read-only PR author
export function reviewRoleForChat(chatSessionId: string, user: AuthUser): ReviewRole | null {
  const rv = getReviewByChat(chatSessionId);
  if (!rv) return null;
  if (user.role === 'admin') return 'admin';
  if (rv.authorUserId && rv.authorUserId === user.id) return 'reader';
  return null;
}

// ── summaries for the client ──
export interface ReviewSessionSummary {
  id: string; chatSessionId: string; repoId: string; repoName: string;
  prNumber: number; prTitle: string; prUrl: string; prState: string;
  authorLogin: string; mergeState: string; readOnly: boolean; updatedAt: number;
}
export function listReviewSessionsForUser(user: AuthUser): ReviewSessionSummary[] {
  const repos = new Map(listRepos().map((r) => [r.id, r]));
  return db.select().from(schema.reviewSessions).orderBy(desc(schema.reviewSessions.updatedAt)).all()
    .filter((rv) => user.role === 'admin' || (rv.authorUserId && rv.authorUserId === user.id))
    .map((rv) => ({
      id: rv.id, chatSessionId: rv.chatSessionId, repoId: rv.repoId, repoName: repos.get(rv.repoId)?.name || '(deleted)',
      prNumber: rv.prNumber, prTitle: rv.prTitle, prUrl: rv.prUrl, prState: rv.prState,
      authorLogin: rv.authorLogin, mergeState: rv.mergeState, readOnly: user.role !== 'admin', updatedAt: rv.updatedAt,
    }));
}

export interface ReviewRepoSummary {
  id: string; name: string; provider: string; host: string; slug: string; gitUrl: string;
  baseBranch: string | null; polledAt: number | null; pollError: string | null;
  openCount: number; createdAt: number;
}
export function listRepoSummaries(): ReviewRepoSummary[] {
  return listRepos().map((r) => ({
    id: r.id, name: r.name, provider: r.provider, host: r.host, slug: r.slug, gitUrl: r.gitUrl,
    baseBranch: r.baseBranch, polledAt: r.polledAt, pollError: r.pollError, createdAt: r.createdAt,
    openCount: db.select().from(schema.reviewSessions)
      .where(and(eq(schema.reviewSessions.repoId, r.id), eq(schema.reviewSessions.prState, 'open'))).all().length,
  }));
}

// Remove review dirs on disk with no matching DB row (leftovers from deletes/crashes). Runs at boot.
export function reapReviewOrphans() {
  try {
    if (!fs.existsSync(paths.reviews)) return;
    const ids = new Set(listRepos().map((r) => r.id));
    for (const name of fs.readdirSync(paths.reviews)) {
      if (ids.has(name)) continue;
      try { fs.rmSync(path.join(paths.reviews, name), { recursive: true, force: true }); } catch { /* noop */ }
    }
  } catch { /* noop */ }
}
