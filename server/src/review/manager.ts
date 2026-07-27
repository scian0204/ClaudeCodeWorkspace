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
  inferProvider, slugFromUrl, listPulls, prHeadFetch, prLocalRef, mergePr, type ReviewProvider, type PullInfo,
} from './providers.js';
import { enqueueTurn } from '../rooms/queue.js';

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

// Grants the read-only "reader" role to the local user whose username equals the PR author's host
// login. ponytail: trusts a free-text host login == local username (trusted-team posture, DESIGN §2);
// the worst case is a *trusted* local member seeing a PR review they didn't author — no external
// access. Upgrade path if watched repos take external PRs: an admin-configured host-login→user
// mapping or verified email/SSO binding instead of the username match.
function matchAuthor(login: string): string | null {
  if (!login) return null;
  const exact = findByUsername(login);
  if (exact) return exact.id;
  const ci = db.select().from(schema.users).all().find((x) => x.username.toLowerCase() === login.toLowerCase());
  return ci?.id ?? null;
}

// Create or refresh the review session for a PR. Reports whether it's brand new and whether the
// PR head moved (author pushed new commits) so the caller can (re)run the auto-review pipeline.
interface UpsertResult { reviewId: string; isNew: boolean; headChanged: boolean }
function upsertReview(repo: Repo, pr: PullInfo): UpsertResult {
  const now = Date.now();
  const authorUserId = matchAuthor(pr.authorLogin);
  const existing = db.select().from(schema.reviewSessions)
    .where(and(eq(schema.reviewSessions.repoId, repo.id), eq(schema.reviewSessions.prNumber, pr.number))).get();
  if (existing) {
    // new commits pushed to the PR → head SHA changed → stale verdict, needs a fresh review
    const headChanged = !!pr.headSha && existing.headSha !== pr.headSha;
    db.update(schema.reviewSessions).set({
      prTitle: pr.title, prUrl: pr.url, prState: 'open', baseRef: pr.baseRef, headRef: pr.headRef,
      headSha: pr.headSha, headCloneUrl: pr.headCloneUrl, authorLogin: pr.authorLogin,
      authorUserId: authorUserId ?? existing.authorUserId,
      verdict: headChanged ? 'none' : existing.verdict,
      verdictSummary: headChanged ? null : existing.verdictSummary,
      updatedAt: now,
    }).where(eq(schema.reviewSessions.id, existing.id)).run();
    db.update(schema.chatSessions).set({ title: `#${pr.number} ${pr.title}` })
      .where(eq(schema.chatSessions.id, existing.chatSessionId)).run();
    if (headChanged) postSystem(existing.chatSessionId, `[자동 리뷰] PR #${pr.number} 새 커밋 감지 (${(pr.headSha || '').slice(0, 7)}) — 다시 리뷰합니다.`);
    return { reviewId: existing.id, isNew: false, headChanged };
  }
  const chatSessionId = newId();
  const reviewId = newId();
  db.insert(schema.chatSessions).values({
    id: chatSessionId, ownerId: repo.createdBy, kind: 'review', roomId: null,
    title: `#${pr.number} ${pr.title}`, projectId: null, wikiTopicId: null, claudeSessionId: null,
    model: 'claude-opus-4-8', permissionMode: 'default', createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.reviewSessions).values({
    id: reviewId, repoId: repo.id, chatSessionId, prNumber: pr.number, prTitle: pr.title, prUrl: pr.url,
    prState: 'open', authorLogin: pr.authorLogin, authorUserId, baseRef: pr.baseRef, headRef: pr.headRef,
    headSha: pr.headSha, headCloneUrl: pr.headCloneUrl, worktreePath: null, mergeState: 'none',
    verdict: 'none', verdictSummary: null, mergedAt: null, createdAt: now, updatedAt: now,
  }).run();
  return { reviewId, isNew: true, headChanged: false };
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
    for (const pr of pulls) {
      const r = upsertReview(repo, pr);
      if (r.isNew) opened++;
      // new PR, or the author pushed new commits → (re)run the pipeline (fire-and-forget)
      if ((r.isNew || r.headChanged) && config.reviewAuto) void autoReview(r.reviewId);
    }
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

// ── auto-review pipeline ──
function setVerdict(id: string, verdict: string, summary: string | null) {
  db.update(schema.reviewSessions).set({ verdict, verdictSummary: summary, updatedAt: Date.now() })
    .where(eq(schema.reviewSessions.id, id)).run();
}

// Persist a system note into the review chat (shown when the session is opened).
function postSystem(chatSessionId: string, text: string) {
  db.insert(schema.messages).values({
    id: newId(), sessionId: chatSessionId, role: 'assistant', authorId: null, authorName: 'Auto-Review',
    content: JSON.stringify({ blocks: [{ type: 'text', text }] }), createdAt: Date.now(),
  }).run();
  db.update(schema.chatSessions).set({ updatedAt: Date.now() }).where(eq(schema.chatSessions.id, chatSessionId)).run();
}

function parseVerdict(text: string): { verdict: string; summary: string | null } {
  const m = text.match(/VERDICT:\s*(MERGE_SAFE|DO_NOT_MERGE)/i);
  const s = text.match(/SUMMARY:\s*(.+)/i);
  const summary = s ? s[1].trim().slice(0, 400) : null;
  if (!m) return { verdict: 'unknown', summary };
  return { verdict: m[1].toUpperCase() === 'MERGE_SAFE' ? 'merge_safe' : 'do_not_merge', summary };
}

function autoPrompt(rv: Review): string {
  return [
    `[자동 코드리뷰] 이 워크트리는 PR #${rv.prNumber} "${rv.prTitle}"를 base 브랜치(${rv.baseRef})에 로컬 머지한 상태다.`,
    `다음을 순서대로 수행하라:`,
    `1) 저장소의 빌드 도구를 감지해 빌드하고, 가능하면 실행/테스트까지 돌린다.`,
    `2) 버그·회귀·보안 문제를 찾는다.`,
    `3) 변경분(diff)을 코드 리뷰하고 핵심 발견을 요약한다.`,
    `4) 이 PR을 base에 병합해도 되는지 종합 판단한다.`,
    `반드시 응답의 마지막 두 줄을 아래 형식으로 정확히 출력하라:`,
    `VERDICT: MERGE_SAFE   (또는  VERDICT: DO_NOT_MERGE)`,
    `SUMMARY: <한 줄 요약>`,
  ].join('\n');
}

// Reviews with a pipeline in flight (from local merge through the agent turn's onDone). Prevents a
// re-run from running `git reset --hard`/merge on the worktree while a live turn is still using it.
const autoRunning = new Set<string>();
// A head change (new push) that arrived while the pipeline was already running — re-review once the
// in-flight run finishes, so a commit pushed mid-review isn't left with a stale/old-commit verdict.
const rerunPending = new Set<string>();

// Full automatic pipeline for one PR: local merge → (unattended) build/run/review turn → verdict.
// Fire-and-forget: called on PR detection (and via the manual re-run route). Errors are recorded
// on the session, never thrown to the caller.
export async function autoReview(reviewId: string): Promise<void> {
  if (autoRunning.has(reviewId)) { rerunPending.add(reviewId); return; } // in flight → queue a re-review
  const rv = getReview(reviewId);
  if (!rv) return;
  autoRunning.add(reviewId);
  const done = () => {
    autoRunning.delete(reviewId);
    // a new push landed during this run → re-review the latest head now
    if (rerunPending.delete(reviewId)) void autoReview(reviewId);
  };
  try {
    setVerdict(rv.id, 'running', null);
    notify();
    const merge = await localMerge(rv);
    if (merge.mergeState === 'conflict') {
      setVerdict(rv.id, 'conflict', '머지 충돌 — 자동 빌드/리뷰 생략, 수동 해결 필요');
      postSystem(rv.chatSessionId, `[자동 리뷰] PR #${rv.prNumber} 머지 충돌로 중단.\n\n${merge.output.slice(0, 800)}`);
      notify(); done();
      return;
    }
    if (merge.mergeState !== 'merged') {
      setVerdict(rv.id, 'error', '로컬 머지 실패');
      notify(); done();
      return;
    }
    // hand the merged worktree to an unattended agent turn (auto-allow tools) that emits the verdict.
    // The guard is held until the turn's onDone so a re-run can't disturb the live worktree.
    const admin = getUserById(getRepo(rv.repoId)?.createdBy || '');
    const author = { id: admin?.id || rv.repoId, name: 'Auto-Review' };
    enqueueTurn(rv.chatSessionId, author, autoPrompt(rv), (finalText) => {
      const { verdict, summary } = parseVerdict(finalText);
      setVerdict(rv.id, verdict, summary);
      notify(); done();
    });
  } catch (e: any) {
    setVerdict(rv.id, 'error', String(e?.message || e).slice(0, 300));
    notify(); done();
  }
}

// Explicit "지시 시 풀리퀘스트 허가": merge the PR on the remote using the merge-capable credential.
// Irreversible outward action — routed admin-only.
export async function approvePr(rv: Review): Promise<{ output: string }> {
  const repo = getRepo(rv.repoId);
  if (!repo) throw new Error('repo not found');
  const cred = resolveGitCredById(repo.credentialId);
  if (!cred) throw new Error('자격증명 없음/복호화 실패');
  const output = await mergePr(repo.provider as ReviewProvider, repo.host, repo.slug, rv.prNumber, {
    username: cred.username, token: cred.token,
  });
  db.update(schema.reviewSessions).set({ prState: 'closed', updatedAt: Date.now() }).where(eq(schema.reviewSessions.id, rv.id)).run();
  postSystem(rv.chatSessionId, `[PR 병합] 원격 병합 완료: ${output}`);
  notify();
  return { output };
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
  authorLogin: string; mergeState: string; verdict: string; verdictSummary: string | null;
  readOnly: boolean; updatedAt: number;
}
export function listReviewSessionsForUser(user: AuthUser): ReviewSessionSummary[] {
  const repos = new Map(listRepos().map((r) => [r.id, r]));
  return db.select().from(schema.reviewSessions).orderBy(desc(schema.reviewSessions.updatedAt)).all()
    .filter((rv) => user.role === 'admin' || (rv.authorUserId && rv.authorUserId === user.id))
    .map((rv) => ({
      id: rv.id, chatSessionId: rv.chatSessionId, repoId: rv.repoId, repoName: repos.get(rv.repoId)?.name || '(deleted)',
      prNumber: rv.prNumber, prTitle: rv.prTitle, prUrl: rv.prUrl, prState: rv.prState,
      authorLogin: rv.authorLogin, mergeState: rv.mergeState, verdict: rv.verdict, verdictSummary: rv.verdictSummary,
      readOnly: user.role !== 'admin', updatedAt: rv.updatedAt,
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
