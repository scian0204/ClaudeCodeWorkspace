import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface GitFile { path: string; index: string; work: string; staged: boolean; }
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
    if (index === 'R' || index === 'C' || work === 'R' || work === 'C') i++; // consume the origin-path token
    out.push({ path: p, index, work, staged: index !== ' ' && index !== '?' });
  }
  return out;
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
  const { stdout } = await git(dir, ['status', '--porcelain', '-z']);
  const files = parsePorcelainZ(stdout);
  return { repo: true, branch, upstream, ahead, behind, files, clean: files.length === 0 };
}

// Stage selected paths (or everything if none given) and commit with the supplied identity env.
export async function gitCommit(dir: string, opts: { message: string; files?: string[]; env?: Env }): Promise<{ commit: string }> {
  const msg = (opts.message || '').trim();
  if (!msg) throw new Error('commit message required');
  const files = (opts.files || []).filter(Boolean);
  try {
    if (files.length) {
      await git(dir, ['add', '--', ...files], opts.env);
      await git(dir, ['commit', '-m', msg, '--', ...files], opts.env);
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
