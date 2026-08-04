// Create the remote repository a project is about to be published to, through the provider's own
// API, using the git credential the user already registered. Only the repo-creation call lives
// here — init / commit / push stay in git-ops.ts, and the caller wires the two together.
//
// `other` has no API we can assume, so it is rejected: that path expects the user to paste a URL
// for a repo they created themselves.
import { cfg } from './config-registry.js';
import type { GitProvider } from '../auth/git-cred.js';

export interface PublishTarget {
  provider: GitProvider; host: string; username: string; token: string;
}

// Repo names are pasted straight into an API path for bitbucket, so keep them to what every
// provider accepts as a slug and refuse anything that could climb out of the path.
export function safeRepoName(n: string): string {
  return String(n || '').trim().replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+/, '').slice(0, 100);
}

async function api(url: string, init: RequestInit): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(cfg.int('gitNetworkTimeoutMs')) });
  } catch (e: any) {
    throw new Error(`${new URL(url).host}: ${String(e?.message || e)}`);
  }
  const text = await r.text();
  let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!r.ok) {
    // providers disagree on the error shape — take whichever field is populated
    const msg = body?.message || body?.error?.message || body?.error || body?.errors?.[0]?.message
      || text.slice(0, 300) || r.statusText;
    throw new Error(`${r.status} ${msg}`);
  }
  return body;
}

// Returns the https clone URL of the newly created repo.
export async function createRemoteRepo(
  t: PublishTarget, a: { name: string; private: boolean },
): Promise<string> {
  const name = safeRepoName(a.name);
  if (!name) throw new Error('repository name required');

  if (t.provider === 'github') {
    // github.com vs GitHub Enterprise, which serves the same API under /api/v3
    const base = t.host === 'github.com' ? 'https://api.github.com' : `https://${t.host}/api/v3`;
    const body = await api(`${base}/user/repos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t.token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'User-Agent': 'claudecode-workspace',
      },
      body: JSON.stringify({ name, private: a.private }),
    });
    if (!body?.clone_url) throw new Error('github: no clone_url in response');
    return String(body.clone_url);
  }

  if (t.provider === 'gitlab') {
    const body = await api(`https://${t.host}/api/v4/projects`, {
      method: 'POST',
      headers: { 'PRIVATE-TOKEN': t.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: name, visibility: a.private ? 'private' : 'public' }),
    });
    if (!body?.http_url_to_repo) throw new Error('gitlab: no http_url_to_repo in response');
    return String(body.http_url_to_repo);
  }

  if (t.provider === 'bitbucket') {
    // bitbucket has no "create under the authenticated user" endpoint — the workspace is explicit,
    // and for a personal token that is the account the credential was registered with.
    if (!t.username) throw new Error('bitbucket: the credential needs a username (used as the workspace)');
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(t.username)}/${encodeURIComponent(name)}`;
    const body = await api(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${t.username}:${t.token}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ scm: 'git', is_private: a.private }),
    });
    const https = (body?.links?.clone || []).find((c: any) => c?.name === 'https');
    if (!https?.href) throw new Error('bitbucket: no https clone link in response');
    return String(https.href);
  }

  throw new Error('this provider cannot create repositories — create one and paste its URL instead');
}
