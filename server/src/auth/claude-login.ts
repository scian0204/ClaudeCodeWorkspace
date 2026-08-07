import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { paths, ensure } from '../lib/paths.js';
import { cfg } from '../lib/config-registry.js';
import { PROVIDER_ENV_KEYS } from './provider.js';
import { applyPrivacyEnv, privacyPlan } from '../claude/privacy.js';

// ── Claude account login, driven through the official CLI ──
// A token from `claude setup-token` is minted inference-only (the CLI calls its OAuth flow with
// inferenceOnly), so it carries user:inference but NOT user:profile — and the CLI gates plan-limit
// reporting on user:profile (`rate_limits_available = hasInference && hasProfile`). That is why an
// sk-ant-oat token shows no 5h/weekly window no matter how healthy the subscription is.
//
// `claude auth login --claudeai` requests the full scope set (org:create_api_key user:profile
// user:inference user:sessions:claude_code user:mcp_servers user:file_upload). With no browser in
// the container it degrades to a line-oriented flow we can drive without a PTY:
//
//   stdout: Opening browser to sign in…
//   stdout: If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&…
//   stdin : <the code the callback page shows>
//
// So: spawn it with HOME pointed at the user's own workspace home, hand the URL to the browser the
// user already has open, take the pasted code back on stdin. The CLI writes .credentials.json
// (accessToken + refreshToken + scopes) into that HOME — the same HOME buildOptions gives every
// turn — so turns pick it up with no token env at all, and token refresh keeps working by itself.

export interface LoginMeta {
  loggedIn: boolean;
  scopes: string[];
  planLimits: boolean;          // scopes include user:profile → the usage popover can show windows
  subscriptionType: string | null;
  expiresAt: number | null;     // epoch millis; past it the CLI refreshes with its refreshToken
}
export const NO_LOGIN: LoginMeta = { loggedIn: false, scopes: [], planLimits: false, subscriptionType: null, expiresAt: null };

const PROFILE_SCOPE = 'user:profile';
const credentialsPath = (userId: string) => path.join(paths.userClaude(userId), '.credentials.json');

// The CLI's own credential record. Read for status only — no token value ever leaves this module.
function readCredentials(userId: string): any | null {
  try { return JSON.parse(fs.readFileSync(credentialsPath(userId), 'utf8'))?.claudeAiOauth ?? null; }
  catch { return null; } // missing / unreadable / malformed → not logged in
}

export function loginMeta(userId: string): LoginMeta {
  const c = readCredentials(userId);
  if (!c?.accessToken) return NO_LOGIN;
  const scopes: string[] = Array.isArray(c.scopes) ? c.scopes.filter((s: any) => typeof s === 'string') : [];
  return {
    loggedIn: true,
    scopes,
    planLimits: scopes.includes(PROFILE_SCOPE),
    subscriptionType: typeof c.subscriptionType === 'string' ? c.subscriptionType : null,
    expiresAt: typeof c.expiresAt === 'number' ? c.expiresAt : null,
  };
}

// Hot path: resolveProvider calls this on every turn and every usage probe. An expired accessToken is
// still a login — the CLI refreshes it with the stored refreshToken, so do NOT gate on expiresAt.
export function hasLogin(userId: string): boolean {
  return !!readCredentials(userId)?.accessToken;
}

// ── the login process ──

interface Pending {
  child: ChildProcess;
  url: string;
  out: string;              // combined stdout+stderr, so a failure reports the CLI's own words
  timer: NodeJS.Timeout;
  codeSent: boolean;
}
const pending = new Map<string, Pending>();

const AUTHORIZE_RE = /https?:\/\/\S*\/oauth\/authorize\S*/;
const cliPath = () => cfg.str('claudeCodePath') || 'claude';

// HOME is the user's workspace home so the credential lands where turns read it. Every
// provider-controlled var is stripped: with ANTHROPIC_API_KEY inherited from the host env the CLI
// treats that key as the active auth and would describe the wrong credential.
function childEnv(userId: string): NodeJS.ProcessEnv {
  ensure(paths.userClaude(userId));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: paths.userHome(userId) };
  for (const k of PROVIDER_ENV_KEYS) delete env[k];
  applyPrivacyEnv(env as Record<string, string>, privacyPlan((k) => cfg.bool(k)));
  return env;
}

export function cancelLogin(userId: string): void {
  const p = pending.get(userId);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(userId);
  try { p.child.kill('SIGKILL'); } catch { /* already gone */ }
}

export function loginInFlight(userId: string): string | null {
  return pending.get(userId)?.url || null;
}

// Start the flow and resolve with the authorize URL the user must open. One in-flight login per
// user — a second start replaces the first (the old PKCE challenge is dead to us anyway).
export function startLogin(userId: string): Promise<{ url: string }> {
  cancelLogin(userId);
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(cliPath(), ['auth', 'login', '--claudeai'], { env: childEnv(userId), stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e: any) { reject(new Error(`cannot start the Claude CLI: ${e?.message || e}`)); return; }

    let settled = false;
    const entry: Pending = {
      child, url: '', out: '', codeSent: false,
      timer: setTimeout(() => fail('sign-in timed out before the link appeared'), cfg.int('claudeLoginStartMs')),
    };
    pending.set(userId, entry);

    function fail(msg: string) {
      if (settled) return;
      settled = true;
      cancelLogin(userId);
      reject(new Error(msg));
    }
    const onChunk = (b: Buffer) => {
      entry.out += b.toString();
      if (settled) return;
      const m = AUTHORIZE_RE.exec(entry.out);
      if (!m) return;
      settled = true;
      clearTimeout(entry.timer);
      entry.url = m[0];
      // From here the user is off in their browser; give them a longer window to paste the code.
      entry.timer = setTimeout(() => cancelLogin(userId), cfg.int('claudeLoginTimeoutMs'));
      resolve({ url: m[0] });
    };
    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (e) => fail(`Claude CLI failed to run: ${e.message}`));
    child.on('exit', () => {
      pending.delete(userId);
      // Exiting before the URL appeared means no flow ever started (already signed in, or blocked by
      // managed settings). Surface the CLI's own words rather than a generic failure.
      fail(lastLine(entry.out) || 'the Claude CLI exited before showing a sign-in link');
    });
  });
}

// Hand the pasted code to the waiting CLI and wait for it to finish writing the credential.
// The code is a single-use OAuth authorization code: written straight to the child's stdin,
// never logged, never stored.
export function submitCode(userId: string, code: string): Promise<LoginMeta> {
  const p = pending.get(userId);
  if (!p) return Promise.reject(new Error('no sign-in is in progress — start one first'));
  if (p.codeSent) return Promise.reject(new Error('a code was already submitted for this sign-in'));
  const trimmed = code.trim();
  if (!trimmed) return Promise.reject(new Error('code required'));
  p.codeSent = true;

  return new Promise((resolve, reject) => {
    const done = setTimeout(() => {
      cancelLogin(userId);
      reject(new Error('the Claude CLI did not finish the sign-in in time'));
    }, cfg.int('claudeLoginFinishMs'));
    p.child.once('exit', (exitCode) => {
      clearTimeout(done);
      clearTimeout(p.timer);
      pending.delete(userId);
      const meta = loginMeta(userId);
      if (meta.loggedIn) { resolve(meta); return; }
      // No credential written: a wrong/expired code, or the account was rejected by policy.
      reject(new Error(lastLine(p.out) || `sign-in failed (claude auth login exited ${exitCode})`));
    });
    try { p.child.stdin?.write(`${trimmed}\n`); } catch (e: any) {
      clearTimeout(done); cancelLogin(userId); reject(new Error(`could not deliver the code: ${e?.message || e}`));
    }
  });
}

// Sign out through the CLI so it clears whatever state it keeps, then make sure the credential file
// is really gone — a stale file would keep resolveProvider routing turns at a dead login.
export function logoutLogin(userId: string): Promise<void> {
  cancelLogin(userId);
  return new Promise((resolve) => {
    const finish = () => {
      try { fs.rmSync(credentialsPath(userId), { force: true }); } catch { /* best effort */ }
      resolve();
    };
    let child: ChildProcess;
    try { child = spawn(cliPath(), ['auth', 'logout'], { env: childEnv(userId), stdio: 'ignore' }); }
    catch { finish(); return; }
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish(); }, cfg.int('claudeLoginFinishMs'));
    child.on('exit', () => { clearTimeout(t); finish(); });
    child.on('error', () => { clearTimeout(t); finish(); });
  });
}

function lastLine(s: string): string {
  const lines = s.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] || '';
}
