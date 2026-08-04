import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { paths, ensure } from '../lib/paths.js';
import { cfg, registerApply } from '../lib/config-registry.js';
import { getUserById, findByUsername, type AuthUser } from '../auth/index.js';
import {
  gitCloneFull, gitFetch, gitFetchRemotes, gitWorktreeAdd, gitWorktreeRemove, gitResetHard, gitMerge, gitDiffNames,
} from '../lib/git-ops.js';
import { hasSourceChange } from './classify.js';
import { newWebhookSecret } from './webhook.js';
import {
  resolveGitCredById, getGitCredRow, askpassEnv, identityEnv, gitIdentity, hostFromGitUrl,
} from '../auth/git-cred.js';
import {
  inferProvider, slugFromUrl, listPulls, prHeadFetch, prLocalRef, mergePr, postComment,
  type ReviewProvider, type PullInfo,
} from './providers.js';
import { enqueueTurn } from '../rooms/queue.js';
import { interruptTurn } from '../claude/session-manager.js';

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
  name?: string; gitUrl: string; credentialId: string; provider?: string; baseBranch?: string; sandboxImage?: string;
  webhook?: boolean; pollEnabled?: boolean;
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
    path: dir, baseBranch: p.baseBranch?.trim() || null, sandboxImage: p.sandboxImage?.trim() || null,
    // Both decided at registration and changeable later (edit dialog): webhook off + polling on by
    // default, since a brand-new repo has no hook wired on the host yet.
    webhookSecret: p.webhook ? newWebhookSecret() : null,
    pollEnabled: p.pollEnabled === false ? 0 : 1,
    createdBy: admin.id, createdAt: now, polledAt: null, pollError: null,
  };
  db.insert(schema.reviewRepos).values(row).run();
  await pollRepo(id).catch(() => { /* error recorded on the row */ });
  return getRepo(id)!;
}

// Edit a registered repo in place — only non-destructive fields (no re-clone). gitUrl/provider/host
// are immutable (changing them means a different repo → delete + re-add). credentialId, when given,
// re-validates host binding + scope exactly like createRepo. baseBranch/sandboxImage: '' clears to null.
export async function updateRepo(admin: AuthUser, id: string, p: {
  name?: string; baseBranch?: string; sandboxImage?: string; credentialId?: string; pollEnabled?: boolean;
}): Promise<Repo> {
  const repo = getRepo(id);
  if (!repo) throw new Error('저장소를 찾을 수 없습니다');
  const patch: Partial<Repo> = {};
  if (p.name !== undefined) {
    const n = p.name.trim();
    if (!n) throw new Error('저장소 이름이 필요합니다');
    patch.name = n;
  }
  if (p.baseBranch !== undefined) patch.baseBranch = p.baseBranch.trim() || null;
  if (p.sandboxImage !== undefined) patch.sandboxImage = p.sandboxImage.trim() || null;
  if (p.pollEnabled !== undefined) patch.pollEnabled = p.pollEnabled ? 1 : 0;
  if (p.credentialId) {
    const credRow = getGitCredRow(p.credentialId);
    if (!credRow) throw new Error('자격증명을 찾을 수 없습니다');
    if (!(credRow.scope === 'common' || (credRow.scope === 'user' && credRow.ownerId === admin.id)))
      throw new Error('사용할 수 없는 자격증명입니다');
    if (credRow.host !== repo.host) throw new Error('자격증명 호스트가 저장소 URL과 일치하지 않습니다');
    patch.credentialId = p.credentialId;
  }
  if (Object.keys(patch).length) {
    db.update(schema.reviewRepos).set(patch).where(eq(schema.reviewRepos.id, id)).run();
    notify();
  }
  return getRepo(id)!;
}

// Enable (or rotate) this repo's inbound webhook secret, or clear it to turn the endpoint off.
// Returns the new secret — the only time it leaves the server in full; the admin pastes it into the
// provider's webhook form. Rotating invalidates whatever the provider currently sends.
export function setWebhook(id: string, enable: boolean): string | null {
  if (!getRepo(id)) throw new Error('저장소를 찾을 수 없습니다');
  const secret = enable ? newWebhookSecret() : null;
  db.update(schema.reviewRepos).set({ webhookSecret: secret }).where(eq(schema.reviewRepos.id, id)).run();
  notify();
  return secret;
}

export function deleteRepo(id: string) {
  const repo = getRepo(id); if (!repo) return;
  pollPending.delete(id); // don't let a queued poll fire for a repo we're deleting
  const rows = db.select().from(schema.reviewSessions).where(eq(schema.reviewSessions.repoId, id)).all();
  for (const rv of rows) {
    forgetReview(rv.id); // clear any in-flight guard/retry state for reviews we're about to delete
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
  forgetReview(rv.id); // clear any in-flight guard/retry state so a deleted review leaves nothing behind
  const repo = getRepo(rv.repoId);
  if (repo && rv.worktreePath) void gitWorktreeRemove(repo.path, rv.worktreePath);
  db.delete(schema.messages).where(eq(schema.messages.sessionId, rv.chatSessionId)).run();
  db.delete(schema.chatSessions).where(eq(schema.chatSessions.id, rv.chatSessionId)).run();
  db.delete(schema.reviewSessions).where(eq(schema.reviewSessions.id, rv.id)).run();
  notify();
}

// ── polling ──
const polling = new Set<string>();
// Repos whose poll was requested while one was already in flight. Without this, a webhook delivery
// (or a push burst) that lands mid-poll is dropped: the running poll read the PR list BEFORE that
// push, and nothing re-reads it — the new commit keeps a stale verdict until the next interval tick,
// or forever when polling is disabled (REVIEW_POLL_MS=0, webhook-only deployments).
const pollPending = new Set<string>();

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
    model: cfg.str('defaultModel'), effort: cfg.str('defaultEffort'), permissionMode: 'default', createdAt: now, updatedAt: now,
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
  if (polling.has(id)) { pollPending.add(id); return { opened: 0, closed: 0 }; }
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
      if ((r.isNew || r.headChanged) && cfg.bool('reviewAuto')) void autoReview(r.reviewId);
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
  } finally {
    polling.delete(id);
    // a request arrived while this one was running → run exactly one more (fire-and-forget)
    if (pollPending.delete(id) && getRepo(id)) void pollRepo(id).catch(() => { /* error recorded on the row */ });
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
// Interval tick only. Repos with polling switched off (webhook-driven) are skipped here — a webhook
// delivery and the manual "refresh now" button still call pollRepo directly, on purpose.
const pollTick = async () => {
  for (const r of listRepos()) {
    if (!r.pollEnabled) continue;
    try { await pollRepo(r.id); } catch { /* on row */ }
  }
};
export function startReviewPoller() {
  scheduleReviewPoller();
  setTimeout(() => { void pollTick(); }, 5000); // one shortly after boot
  setTimeout(() => { recoverInterruptedReviews(); }, 8000); // resume reviews a restart interrupted
}

// Crash/restart recovery. A review left at verdict='running' has no live pipeline behind it — the
// in-memory guard, watchdog timer, and turn subprocess all died with the previous process — and
// polling will NEVER revive it (the PR isn't new and its head hasn't moved). Without this, an
// auto-review that was in flight when the container was recreated/restarted hangs on 'running'
// forever. Re-queue every such open review at boot so it resumes instead of stalling. Gated by
// reviewAuto (respects the global auto-review toggle) and best-effort (never blocks startup).
export function recoverInterruptedReviews() {
  let stuck: Review[];
  try {
    stuck = db.select().from(schema.reviewSessions)
      .where(and(eq(schema.reviewSessions.verdict, 'running'), eq(schema.reviewSessions.prState, 'open'))).all();
  } catch { return; } // DB not readable at boot → nothing to recover
  if (!stuck.length) return;
  const auto = cfg.bool('reviewAuto');
  for (const rv of stuck) {
    // Per-review guard: one bad row (deleted chat session, a transient SQLite-busy at boot) must not
    // abandon recovery for every remaining stuck review.
    try {
      if (auto) {
        postSystem(rv.chatSessionId, `[자동 리뷰] 서버 재시작으로 중단된 리뷰를 자동으로 다시 실행합니다.`);
        void autoReview(rv.id);
      } else {
        // Auto-review is off: don't leave a misleading, permanent 'running'. Mark it interrupted so
        // the operator sees what happened and can re-run it by hand (polling won't revive it either).
        setVerdict(rv.id, 'error', '서버 재시작으로 리뷰가 중단되었습니다 (자동 리뷰 꺼짐 — 수동으로 다시 실행하세요).');
        postSystem(rv.chatSessionId, `[자동 리뷰] 서버 재시작으로 중단됨. 자동 리뷰가 꺼져 있어 자동 재실행하지 않습니다 — "자동 리뷰 실행"으로 다시 시도하세요.`);
      }
    } catch { /* skip this row, keep recovering the rest */ }
  }
  notify();
}
// (Re)arm the poll interval from the live config. Called at boot and whenever reviewPollMs changes
// (admin edit) so a new interval takes effect without a restart. reviewPollMs <= 0 disables polling.
export function scheduleReviewPoller() {
  if (timer) { clearInterval(timer); timer = null; }
  const ms = cfg.int('reviewPollMs');
  if (ms <= 0) return;
  timer = setInterval(() => { void pollTick(); }, ms);
}
registerApply('reviewPollMs', () => scheduleReviewPoller());

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

// Fetch the PR head into its local ref (no worktree/merge). Shared by the changed-file probe and
// the local merge. Returns the local ref name.
async function fetchPrHead(repo: Repo, rv: Review, env?: Record<string, string>): Promise<string> {
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
  return localRef;
}

// Read the PR's changed files without merging (fetch head + diff vs base). Returns null if it can't
// be determined — the caller then falls back to the full pipeline rather than wrongly skipping.
async function prChangedFiles(rv: Review): Promise<string[] | null> {
  const repo = getRepo(rv.repoId);
  if (!repo) return null;
  const cred = resolveGitCredById(repo.credentialId);
  const env = cred ? askpassEnv(cred) : undefined;
  try {
    const localRef = await fetchPrHead(repo, rv, env);
    const base = rv.baseRef || repo.baseBranch || 'HEAD';
    return await gitDiffNames(repo.path, `origin/${base}...${localRef}`, env);
  } catch { return null; }
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

  const localRef = await fetchPrHead(repo, rv, env);

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

const VERDICT_LABEL: Record<string, string> = {
  merge_safe: '✅ 병합 가능 (MERGE_SAFE)',
  do_not_merge: '⛔ 병합 불가 (DO_NOT_MERGE)',
  unknown: '❔ 판정 불명 (모델이 VERDICT 미출력)',
};

// Publish a finished auto-review back onto the PR as a comment (GitHub issue comment / GitLab MR
// note / Bitbucket PR comment), using the same merge-capable credential. Best-effort: any failure
// is recorded as a system note in the review chat and never breaks the pipeline. Gated by
// config.reviewComment so a deployment can keep reviews internal to the workspace.
async function postReviewComment(rv: Review, finalText: string, verdict: string, summary: string | null) {
  if (!cfg.bool('reviewComment')) return;
  const repo = getRepo(rv.repoId);
  if (!repo) return;
  const cred = resolveGitCredById(repo.credentialId);
  if (!cred) return;
  // Strip the machine-readable VERDICT/SUMMARY trailer from the body — re-rendered as a header below.
  const body = finalText
    .replace(/\n*VERDICT:\s*(MERGE_SAFE|DO_NOT_MERGE)[^\n]*/i, '')
    .replace(/\n*SUMMARY:\s*[^\n]*/i, '').trim();
  const sha = (rv.headSha || '').slice(0, 7);
  const md = [
    `## 🤖 자동 코드리뷰 결과`,
    ``,
    `**판정:** ${VERDICT_LABEL[verdict] || verdict}`,
    summary ? `\n> ${summary}` : ``,
    ``,
    `---`,
    ``,
    body || '(리뷰 본문 없음)',
    ``,
    `<sub>ClaudeCode Workspace 자동 리뷰${sha ? ` · ${sha}` : ``}</sub>`,
  ].join('\n');
  try {
    await postComment(repo.provider as ReviewProvider, repo.host, repo.slug, rv.prNumber,
      { username: cred.username, token: cred.token }, md);
    postSystem(rv.chatSessionId, `[자동 리뷰] 결과를 PR #${rv.prNumber} 코멘트로 게시했습니다.`);
  } catch (e: any) {
    postSystem(rv.chatSessionId, `[자동 리뷰] PR 코멘트 게시 실패: ${String(e?.message || e).slice(0, 200)}`);
  }
}

function autoPrompt(rv: Review): string {
  return [
    `[자동 코드리뷰] 이 워크트리는 PR #${rv.prNumber} "${rv.prTitle}"를 base 브랜치(${rv.baseRef})에 로컬 머지한 상태다.`,
    `다음을 순서대로 수행하라:`,
    `1) 빌드/실행/테스트는 반드시 격리 샌드박스 도구(mcp__sandbox__run)로 실행한다. 이 도구가 네 도구 목록에 있으면 그것이 곧 격리된 빌드 환경이다 — 호스트에 'docker' 명령이 보이는지 등으로 빌드 가능 여부를 넘겨짚지 말고, 도구가 있으면 무조건 그 안에서 빌드를 시도한다(도구가 없을 때만 사용 가능한 셸로 실행). 저장소의 빌드 도구를 감지해 빌드하고 가능하면 실행/테스트까지 돌린다.`,
    `   '빌드 미실행(환경 제약)'은 샌드박스 안에서 실제로 빌드를 시도한 뒤 툴체인이 정말 없거나(설치 불가), 이 Linux 샌드박스로는 불가한 스택(.NET Framework 등 Windows 전용)일 때만 선언한다 — 시도도 안 해보고 미리 단정하지 말 것. 빌드를 안 돌렸으면 통과했다고 단정하지 말고 SUMMARY에 그 사유를 명시한다.`,
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
// Per-review count of automatic retries already spent on a timed-out/interrupted turn. In-memory on
// purpose: a fresh process = fresh budget, which is exactly what boot recovery wants. Cleared the
// moment the review reaches any terminal verdict (see setFinal), so a later re-review starts clean.
const attempts = new Map<string, number>();
// Drop a review's in-flight bookkeeping. Called when the review/repo is deleted mid-pipeline (so the
// guard Set + retry Map don't accumulate dead ids) and when a queued re-run finds the review gone.
function forgetReview(reviewId: string) {
  autoRunning.delete(reviewId);
  rerunPending.delete(reviewId);
  attempts.delete(reviewId);
}

// Full automatic pipeline for one PR: local merge → (unattended) build/run/review turn → verdict.
// Fire-and-forget: called on PR detection (and via the manual re-run route). Errors are recorded
// on the session, never thrown to the caller.
export async function autoReview(reviewId: string): Promise<void> {
  if (autoRunning.has(reviewId)) { rerunPending.add(reviewId); return; } // in flight → queue a re-review
  const rv = getReview(reviewId);
  if (!rv) { forgetReview(reviewId); return; } // review deleted before a queued re-run fired → don't leak state
  autoRunning.add(reviewId);
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let finalized = false;
  // Write the final verdict once — whichever of onDone / watchdog / early-exit reaches it first wins.
  // Returns true only for the caller that actually set it, so onDone knows whether IT produced the
  // real verdict (vs. the watchdog having already timed the turn out) before publishing to the PR.
  const setFinal = (verdict: string, summary: string | null): boolean => {
    if (finalized) return false;
    finalized = true;
    setVerdict(rv.id, verdict, summary);
    attempts.delete(reviewId); // terminal verdict reached → reset the retry budget for future re-reviews
    notify();
    return true;
  };
  // Release the worktree guard + fire a queued re-review. Called ONLY at real turn teardown (the
  // turn's onDone, after its subprocess is gone) or on a pre-turn early exit — NEVER from the
  // watchdog — so a re-run's `git reset --hard`/merge can't race a still-terminating turn on the
  // same worktree. delete() returns false the second time, so the rerun fires at most once.
  const done = () => {
    if (watchdog) clearTimeout(watchdog);
    if (!autoRunning.delete(reviewId)) return;
    if (rerunPending.delete(reviewId)) void autoReview(reviewId);
  };
  try {
    setVerdict(rv.id, 'running', null);
    notify();
    // Read the diff first: a PR that changes only non-source files (docs, assets) needs no local
    // merge or sandbox build/run. Review it lightweight and mark merge-safe. On any probe failure
    // (files === null) fall through to the full pipeline rather than wrongly skipping a code PR.
    const files = await prChangedFiles(rv);
    if (files && files.length && !hasSourceChange(files)) {
      const list = files.slice(0, 30).map((f) => `- ${f}`).join('\n')
        + (files.length > 30 ? `\n… 외 ${files.length - 30}개` : '');
      setFinal('merge_safe', '문서/비소스 파일 변경만 있어 머지·빌드·실행을 생략했습니다.');
      postSystem(rv.chatSessionId, `[자동 리뷰] PR #${rv.prNumber} 소스 변경 없음 (문서/비소스 ${files.length}개) — 머지·빌드·실행 생략.\n\n${list}`);
      void postReviewComment(rv, `문서/비소스 파일만 변경되어 자동 빌드·실행을 생략했습니다.\n\n변경 파일:\n${list}`,
        'merge_safe', '문서/비소스 파일 변경만 있어 머지·빌드·실행을 생략했습니다.');
      done();
      return;
    }
    const merge = await localMerge(rv);
    if (merge.mergeState === 'conflict') {
      setFinal('conflict', '머지 충돌 — 자동 빌드/리뷰 생략, 수동 해결 필요');
      postSystem(rv.chatSessionId, `[자동 리뷰] PR #${rv.prNumber} 머지 충돌로 중단.\n\n${merge.output.slice(0, 800)}`);
      done();
      return;
    }
    if (merge.mergeState !== 'merged') {
      setFinal('error', '로컬 머지 실패');
      done();
      return;
    }
    const admin = getUserById(getRepo(rv.repoId)?.createdBy || '');
    const author = { id: admin?.id || rv.repoId, name: 'Auto-Review' };
    // Fresh conversation every run — never resume the prior review. Resuming makes the model treat a
    // re-review (new commit pushed) as "same task" and rubber-stamp the stale verdict instead of
    // re-examining the updated worktree.
    db.update(schema.chatSessions).set({ claudeSessionId: null }).where(eq(schema.chatSessions.id, rv.chatSessionId)).run();
    // watchdog: abort a hung turn so the verdict resolves off 'running'. It only aborts + records the
    // verdict; the guard release + any queued re-review happen in the turn's onDone (fired by the
    // abort's teardown), so the worktree stays exclusive until the subprocess has actually exited.
    const turnTimeoutMs = cfg.int('reviewTurnTimeoutMs');
    const maxRetries = cfg.int('reviewMaxRetries');
    watchdog = setTimeout(() => {
      interruptTurn(rv.chatSessionId); // graceful interrupt → hard abort; the turn's onDone fires at teardown
      const used = attempts.get(reviewId) || 0;
      const mins = Math.round(turnTimeoutMs / 60000);
      if (used < maxRetries) {
        // Likely a transient hang, not a permanent failure: keep the review 'running' and queue a fresh
        // run. It fires from done() (the aborted turn's onDone) so the retry's git reset/merge can't race
        // a still-terminating turn on the same worktree. finalized=true suppresses this run's onDone
        // verdict + PR comment (its finalText is a partial/aborted review, not a real judgment).
        attempts.set(reviewId, used + 1);
        finalized = true;
        setVerdict(rv.id, 'running', null);
        notify();
        rerunPending.add(reviewId);
        postSystem(rv.chatSessionId, `[자동 리뷰] 시간 초과(${mins}분) — 자동 재시도합니다 (${used + 1}/${maxRetries}).`);
      } else {
        setFinal('error', `자동 리뷰 시간 초과(${mins}분) — 재시도 ${maxRetries}회 소진 후 중단됨`);
        postSystem(rv.chatSessionId, `[자동 리뷰] 시간 초과로 중단(자동 재시도 ${maxRetries}회 소진). 다시 시도하려면 "자동 리뷰 실행"을 누르세요.`);
      }
    }, turnTimeoutMs);
    enqueueTurn(rv.chatSessionId, author, autoPrompt(rv), (finalText) => {
      const { verdict, summary } = parseVerdict(finalText);
      // Only publish to the PR if THIS turn produced the verdict — if the watchdog already timed the
      // turn out, finalText is a partial/aborted review and setFinal returns false (skip the comment).
      if (setFinal(verdict, summary)) void postReviewComment(rv, finalText, verdict, summary);
      done(); // real teardown: safe to release the worktree + re-review the latest head
    });
  } catch (e: any) {
    setFinal('error', String(e?.message || e).slice(0, 300));
    done();
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
  baseBranch: string | null; sandboxImage: string | null; polledAt: number | null; pollError: string | null;
  webhookSecret: string | null; // admin-only route: the admin must be able to re-read it to reconfigure the hook
  pollEnabled: boolean;         // off → this repo runs on webhook deliveries + the manual refresh only
  openCount: number; createdAt: number;
}
export function listRepoSummaries(): ReviewRepoSummary[] {
  return listRepos().map((r) => ({
    id: r.id, name: r.name, provider: r.provider, host: r.host, slug: r.slug, gitUrl: r.gitUrl,
    baseBranch: r.baseBranch, sandboxImage: r.sandboxImage, polledAt: r.polledAt, pollError: r.pollError,
    webhookSecret: r.webhookSecret, pollEnabled: !!r.pollEnabled, createdAt: r.createdAt,
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
