import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface GitFile { path: string; index: string; work: string; staged: boolean; orig?: string; }
export interface GitStatus {
  repo: boolean; branch: string; upstream: boolean;
  ahead: number; behind: number; files: GitFile[]; clean: boolean;
}

type Env = Record<string, string>;
const baseEnv = (extra?: Env): Env => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', ...(extra || {}) } as Env);

async function git(dir: string, args: string[], env?: Env, timeout = 120_000) {
  return execFileP('git', ['-C', dir, ...args], { env: baseEnv(env), timeout, maxBuffer: 8 * 1024 * 1024 });
}

function gitErr(e: any): string {
  return String(e?.stderr || e?.message || e).trim().slice(0, 500);
}

export async function isRepo(dir: string): Promise<boolean> {
  try { const { stdout } = await git(dir, ['rev-parse', '--is-inside-work-tree']); return stdout.trim() === 'true'; }
  catch { return false; }
}

export async function originHost(dir: string): Promise<string | null> {
  try {
    const { stdout } = await git(dir, ['remote', 'get-url', 'origin']);
    return hostFromUrl(stdout.trim());
  } catch { return null; }
}
export async function originUrl(dir: string): Promise<string | null> {
  try { const { stdout } = await git(dir, ['remote', 'get-url', 'origin']); return stdout.trim() || null; }
  catch { return null; }
}
function hostFromUrl(url: string): string | null {
  let m = url.match(/^[a-zA-Z]+:\/\/(?:[^/@]+@)?([^/:]+)/); if (m) return m[1].toLowerCase();
  m = url.match(/^[^@\s]+@([^:/\s]+):/); if (m) return m[1].toLowerCase();
  return null;
}

// Parse `git status --porcelain -z` (NUL-separated; R/C records carry an extra origin-path token).
function parsePorcelainZ(buf: string): GitFile[] {
  const toks = buf.split('\0');
  const out: GitFile[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t || t.length < 3) continue;
    const index = t[0], work = t[1], p = t.slice(3);
    const isRename = index === 'R' || index === 'C' || work === 'R' || work === 'C';
    const orig = isRename ? toks[++i] : undefined; // origin path follows in the next NUL token
    out.push({ path: p, index, work, staged: index !== ' ' && index !== '?', ...(orig ? { orig } : {}) });
  }
  return out;
}

async function changedFiles(dir: string): Promise<GitFile[]> {
  const { stdout } = await git(dir, ['status', '--porcelain', '-z']);
  return parsePorcelainZ(stdout);
}

export async function gitStatus(dir: string): Promise<GitStatus> {
  if (!(await isRepo(dir))) return { repo: false, branch: '', upstream: false, ahead: 0, behind: 0, files: [], clean: true };
  let branch = '';
  try { branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(); } catch { /* unborn branch */ }
  if (!branch || branch === 'HEAD') {
    try { branch = (await git(dir, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim(); } catch { branch = branch || 'HEAD'; }
  }
  let upstream = false, ahead = 0, behind = 0;
  try {
    const { stdout } = await git(dir, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
    const [b, a] = stdout.trim().split(/\s+/).map((n) => Number(n) || 0);
    behind = b; ahead = a; upstream = true;
  } catch { /* no upstream configured */ }
  const files = await changedFiles(dir);
  return { repo: true, branch, upstream, ahead, behind, files, clean: files.length === 0 };
}

// Stage selected paths (or everything if none given) and commit with the supplied identity env.
export async function gitCommit(dir: string, opts: { message: string; files?: string[]; env?: Env }): Promise<{ commit: string }> {
  const msg = (opts.message || '').trim();
  if (!msg) throw new Error('commit message required');
  const files = (opts.files || []).filter(Boolean);
  try {
    if (files.length) {
      // Expand any selected staged rename to include its origin path, else `commit -- <new>`
      // drops the staged deletion of the old path and commits only half the rename.
      const renames = new Map((await changedFiles(dir)).filter((f) => f.orig).map((f) => [f.path, f.orig!]));
      const pathspec = [...new Set(files.flatMap((f) => (renames.has(f) ? [f, renames.get(f)!] : [f])))];
      await git(dir, ['add', '--', ...files], opts.env);
      await git(dir, ['commit', '-m', msg, '--', ...pathspec], opts.env);
    } else {
      await git(dir, ['add', '-A'], opts.env);
      await git(dir, ['commit', '-m', msg], opts.env);
    }
  } catch (e: any) { throw new Error(gitErr(e)); }
  const { stdout } = await git(dir, ['rev-parse', '--short', 'HEAD']);
  return { commit: stdout.trim() };
}

// Push the current branch to origin, setting upstream (idempotent whether or not one exists).
export async function gitPush(dir: string, opts: { env?: Env }): Promise<{ output: string }> {
  try {
    const { stdout, stderr } = await git(dir, ['push', '-u', 'origin', 'HEAD'], opts.env, 180_000);
    return { output: (stderr || stdout || '').trim().slice(0, 1000) };
  } catch (e: any) { throw new Error(gitErr(e)); }
}

export interface GitBranches { repo: boolean; current: string; local: string[]; remote: string[]; }

export async function gitBranches(dir: string): Promise<GitBranches> {
  if (!(await isRepo(dir))) return { repo: false, current: '', local: [], remote: [] };
  let current = '';
  try { current = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim(); } catch { /* unborn */ }
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const local = lines((await git(dir, ['branch', '--format=%(refname:short)'])).stdout);
  let remote: string[] = [];
  try {
    remote = lines((await git(dir, ['branch', '-r', '--format=%(refname:short)'])).stdout)
      .filter((b) => !b.endsWith('/HEAD') && !b.includes('->')); // drop the symbolic origin/HEAD
  } catch { /* no remotes */ }
  return { repo: true, current, local, remote };
}

// Refresh remote-tracking refs (full fetch — no --depth so a full clone stays full; a --depth 1
// fetch here would re-shallow it). Widen the refspec to all branches first in case an older
// single-branch clone exists. Best-effort: offline / auth failure / no origin leaves refs untouched.
export async function gitFetchRemotes(dir: string, env?: Env): Promise<void> {
  if (!(await isRepo(dir))) return;
  try {
    await git(dir, ['remote', 'set-branches', 'origin', '*'], env);
    await git(dir, ['fetch', 'origin'], env, 180_000);
  } catch { /* keep whatever refs we already have */ }
}

// Switch branches. `git checkout <name>` DWIMs: an existing local branch is checked out;
// a name that only exists on a remote auto-creates a local tracking branch. Fails (surfaced)
// if the working tree has changes that would be overwritten.
export async function gitCheckout(dir: string, opts: { branch: string; env?: Env }): Promise<{ branch: string }> {
  const b = (opts.branch || '').trim();
  if (!b) throw new Error('branch required');
  try { await git(dir, ['checkout', b], opts.env); }
  catch (e: any) { throw new Error(gitErr(e)); }
  return { branch: b };
}
