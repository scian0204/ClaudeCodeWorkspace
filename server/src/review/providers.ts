// PR/MR listing across GitHub, GitLab, and Bitbucket Cloud. Auth uses the same HTTPS credential
// (username + PAT) that clones/fetches the repo, resolved by host. No SDKs — plain fetch against
// each host's REST API. Self-hosted GitHub Enterprise / GitLab are covered via the host field.

export type ReviewProvider = 'github' | 'gitlab' | 'bitbucket';

export interface PullInfo {
  number: number;              // PR number (github/bitbucket) or MR iid (gitlab)
  title: string;
  url: string;                 // web URL
  authorLogin: string;         // author's host username
  baseRef: string;             // target branch
  headRef: string;             // source branch
  headSha: string | null;
  headCloneUrl: string | null; // set only for a fork PR whose head isn't reachable via origin refs
}

export interface HostCred { username: string; token: string; }

const UA = 'ccw-review';

export function inferProvider(host: string, hint?: string): ReviewProvider {
  const h = (hint || '').toLowerCase();
  if (h === 'github' || h === 'gitlab' || h === 'bitbucket') return h;
  const host2 = host.toLowerCase();
  if (host2.includes('gitlab')) return 'gitlab';
  if (host2.includes('bitbucket')) return 'bitbucket';
  return 'github';
}

// Extract the repo slug from a clone URL. github/bitbucket → 'owner/repo'; gitlab → nested group path.
export function slugFromUrl(url: string): string | null {
  const s = url.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  let m = s.match(/^[a-zA-Z]+:\/\/(?:[^/@]+@)?[^/]+\/(.+)$/); // scheme://[user@]host/PATH
  if (m) return m[1];
  m = s.match(/^[^@\s]+@[^:]+:(.+)$/);                        // git@host:PATH
  if (m) return m[1];
  return null;
}

export function prLocalRef(prNumber: number): string { return `refs/ccw/pr-${prNumber}`; }

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { throw new Error(`bad JSON from ${url}`); }
}

// ── GitHub (+ GHE via host/api/v3) ──
async function githubPulls(host: string, slug: string, cred: HostCred): Promise<PullInfo[]> {
  const base = host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
  const data = await getJson(`${base}/repos/${slug}/pulls?state=open&per_page=100`, {
    Authorization: `Bearer ${cred.token}`, Accept: 'application/vnd.github+json',
  });
  return (data || []).map((p: any): PullInfo => {
    const headRepo = p.head?.repo?.full_name, baseRepo = p.base?.repo?.full_name;
    const isFork = !!headRepo && !!baseRepo && headRepo !== baseRepo;
    return {
      number: p.number, title: p.title || `PR #${p.number}`, url: p.html_url || '',
      authorLogin: p.user?.login || '', baseRef: p.base?.ref || '', headRef: p.head?.ref || '',
      headSha: p.head?.sha || null, headCloneUrl: isFork ? (p.head?.repo?.clone_url || null) : null,
    };
  });
}

// ── GitLab (self-hosted or gitlab.com) ──
async function gitlabPulls(host: string, slug: string, cred: HostCred): Promise<PullInfo[]> {
  const base = `https://${host}/api/v4`;
  const data = await getJson(`${base}/projects/${encodeURIComponent(slug)}/merge_requests?state=opened&per_page=100`, {
    'PRIVATE-TOKEN': cred.token,
  });
  // GitLab publishes refs/merge-requests/<iid>/head on the TARGET project, so even a fork's head
  // fetches from origin — no separate clone URL is ever needed.
  return (data || []).map((m: any): PullInfo => ({
    number: m.iid, title: m.title || `MR !${m.iid}`, url: m.web_url || '',
    authorLogin: m.author?.username || '', baseRef: m.target_branch || '', headRef: m.source_branch || '',
    headSha: m.sha || null, headCloneUrl: null,
  }));
}

// ── Bitbucket Cloud ──
async function bitbucketPulls(host: string, slug: string, cred: HostCred): Promise<PullInfo[]> {
  const auth = Buffer.from(`${cred.username}:${cred.token}`).toString('base64');
  const data = await getJson(`https://api.bitbucket.org/2.0/repositories/${slug}/pullrequests?state=OPEN&pagelen=50`, {
    Authorization: `Basic ${auth}`,
  });
  return (data?.values || []).map((p: any): PullInfo => {
    const srcRepo = p.source?.repository?.full_name;
    const isFork = !!srcRepo && srcRepo !== slug;
    return {
      number: p.id, title: p.title || `PR #${p.id}`, url: p.links?.html?.href || '',
      authorLogin: p.author?.nickname || p.author?.display_name || '',
      baseRef: p.destination?.branch?.name || '', headRef: p.source?.branch?.name || '',
      headSha: p.source?.commit?.hash || null,
      headCloneUrl: isFork ? `https://${host}/${srcRepo}.git` : null,
    };
  });
}

export function listPulls(provider: ReviewProvider, host: string, slug: string, cred: HostCred): Promise<PullInfo[]> {
  if (provider === 'gitlab') return gitlabPulls(host, slug, cred);
  if (provider === 'bitbucket') return bitbucketPulls(host, slug, cred);
  return githubPulls(host, slug, cred);
}

// The refspec that fetches a PR's head into a local ref from `origin`, per provider.
// Returns null when the head must be fetched from the fork clone URL instead (Bitbucket forks) —
// the caller then does `git fetch <headCloneUrl> <headRef>:<prLocalRef>`.
export function prHeadFetch(provider: ReviewProvider, pr: PullInfo): { refspec: string; localRef: string } | null {
  const localRef = prLocalRef(pr.number);
  if (provider === 'github') return { refspec: `pull/${pr.number}/head:${localRef}`, localRef };
  if (provider === 'gitlab') return { refspec: `merge-requests/${pr.number}/head:${localRef}`, localRef };
  if (!pr.headCloneUrl) return { refspec: `${pr.headRef}:${localRef}`, localRef }; // bitbucket, same repo
  return null; // bitbucket fork → fetch from headCloneUrl
}
