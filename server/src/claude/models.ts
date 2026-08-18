import { cfg, registerApply, setConfigValue } from '../lib/config-registry.js';
import { resolveProvider } from '../auth/provider.js';
import { loginAccessToken } from '../auth/claude-login.js';

// Auto-fetched model list. Frontier model ids move fast (a new Opus/Sonnet drops and the hardcoded
// map is stale), so instead of hand-editing `models` an admin can let the server pull the live list
// from the Anthropic-compatible `/v1/models` endpoint — api.anthropic.com, or whatever a `custom`
// provider's base URL points at (LiteLLM & friends serve the same route). The result is written
// back into the `models` config, so there is still exactly ONE source for the dropdown and the
// admin can keep editing it by hand (turn modelsAutoFetch off, or the next refresh overwrites).
//
// Auth comes from the COMMON scope (resolveProvider(null)): the list is workspace-wide, so it must
// not depend on whichever user happens to be asking. That scope can be a browser sign-in rather than
// a pasted token, and then the resolver hands back no token env at all — only the directory of the
// CLI's credential store — so this reads the account's access token out of that store itself.

interface ApiModel { id?: string; display_name?: string; created_at?: string }

// Which credential the request carries, from the resolved provider env. Explicit tokens win over the
// sign-in store: a pasted token is deliberate configuration, a sign-in is ambient (same order as
// resolveProvider). `readToken` is injectable only so the self-check below can skip the filesystem.
export function authHeaders(
  env: Record<string, string>,
  readToken: (dir: string) => string | null = loginAccessToken,
): Record<string, string> {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  const oauth = (tok: string) => {
    headers.authorization = `Bearer ${tok}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  };
  if (env.ANTHROPIC_API_KEY) headers['x-api-key'] = env.ANTHROPIC_API_KEY;
  else if (env.CLAUDE_CODE_OAUTH_TOKEN) oauth(env.CLAUDE_CODE_OAUTH_TOKEN);
  else if (env.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`;
  else if (env.CLAUDE_SECURESTORAGE_CONFIG_DIR) {
    // Browser sign-in: no token in the env at all, just the store the CLI keeps the account's
    // credential in. Without this branch every fetch here failed with "no Claude token or API key
    // configured" for anyone who signed in instead of pasting a token.
    const tok = readToken(env.CLAUDE_SECURESTORAGE_CONFIG_DIR);
    if (!tok) throw new Error('the signed-in Claude account has no readable credential — sign in again');
    oauth(tok);
  } else if (!env.ANTHROPIC_BASE_URL) throw new Error('no Claude token or API key configured');
  return headers;
}

function endpoint(): { url: string; headers: Record<string, string> } {
  const { env } = resolveProvider(null);
  if (env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX) {
    throw new Error('bedrock/vertex expose no /v1/models endpoint — edit the model list by hand');
  }
  const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  return { url: `${base}/v1/models?limit=1000`, headers: authHeaders(env) };
}

// "Claude Opus 4.1" → "Opus 4.1" (the chat pill is narrow); no display_name → the raw id.
const label = (m: ApiModel): string => (m.display_name || '').replace(/^Claude\s+/i, '').trim() || String(m.id);

// Newest `modelsMax` models as an (id → label) map. Anthropic already returns newest-first; a proxy
// may not, so re-sort on created_at when it is there (all-missing → localeCompare 0 → API order).
export async function fetchModels(): Promise<Record<string, string>> {
  const { url, headers } = endpoint();
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(cfg.int('modelsFetchTimeoutMs')) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${text.slice(0, 300)}`);
  let data: unknown;
  try { data = (JSON.parse(text) as any)?.data; } catch { throw new Error(`bad JSON from ${url}`); }
  if (!Array.isArray(data)) throw new Error('no models returned');
  const sorted = (data as ApiModel[])
    .filter((m) => m?.id)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (!sorted.length) throw new Error('no models returned');
  return Object.fromEntries(sorted.slice(0, cfg.int('modelsMax')).map((m) => [String(m.id), label(m)]));
}

// Fetch + persist into `models` (the key every consumer already reads).
export async function refreshModels(): Promise<Record<string, string>> {
  const models = await fetchModels();
  setConfigValue('models', JSON.stringify(models));
  return models;
}

// (Re)arm the refresh interval from the live config: at boot and on any admin edit of the two keys.
let timer: NodeJS.Timeout | null = null;
export function scheduleModelRefresh() {
  if (timer) { clearInterval(timer); timer = null; }
  if (!cfg.bool('modelsAutoFetch')) return;
  const tick = () => { void refreshModels().catch((e) => console.warn('[ccw] model auto-fetch failed:', e?.message || e)); };
  tick();
  timer = setInterval(tick, cfg.int('modelsRefreshMs'));
}
registerApply('modelsAutoFetch', () => scheduleModelRefresh());
registerApply('modelsRefreshMs', () => scheduleModelRefresh());

// ── self-check (run once: MODELS_SELFCHECK=1 npx tsx server/src/claude/models.ts) ──
// Covers the parse/sort/label/cap logic without touching the network or the DB.
if (process.env.MODELS_SELFCHECK) {
  const assert = (cond: boolean, m: string) => { if (!cond) throw new Error('models check failed: ' + m); };
  const rows: ApiModel[] = [
    { id: 'old-1', display_name: 'Claude Sonnet 3.7', created_at: '2025-02-19T00:00:00Z' },
    { id: 'new-1', display_name: 'Claude Opus 5', created_at: '2026-05-01T00:00:00Z' },
    { id: 'mid-1', created_at: '2026-01-01T00:00:00Z' },
  ];
  const sorted = rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  assert(sorted[0].id === 'new-1', 'newest model sorts first');
  assert(label(sorted[0]) === 'Opus 5', 'the "Claude " prefix is stripped from the label');
  assert(label(sorted[1]) === 'mid-1', 'no display_name → the raw id is the label');

  // auth header selection, incl. the browser-sign-in path (no token env, just the store directory)
  const h = (env: Record<string, string>) => authHeaders(env, (d) => (d === '/store' ? 'sk-ant-oat-live' : null));
  assert(h({ ANTHROPIC_API_KEY: 'sk-ant-api-1' })['x-api-key'] === 'sk-ant-api-1', 'api key → x-api-key');
  const login = h({ CLAUDE_SECURESTORAGE_CONFIG_DIR: '/store' });
  assert(login.authorization === 'Bearer sk-ant-oat-live', 'sign-in → bearer from the credential store');
  assert(login['anthropic-beta'] === 'oauth-2025-04-20', 'sign-in → oauth beta header');
  const both = h({ ANTHROPIC_API_KEY: 'sk-ant-api-1', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/store' });
  assert(!both.authorization, 'a pasted token wins over the sign-in store');
  let threw = false;
  try { h({ CLAUDE_SECURESTORAGE_CONFIG_DIR: '/empty' }); } catch { threw = true; }
  assert(threw, 'sign-in with an unreadable credential is an error, not an unauthenticated call');
  assert(!!h({ ANTHROPIC_BASE_URL: 'http://proxy' }) && !h({ ANTHROPIC_BASE_URL: 'http://proxy' }).authorization,
    'a custom base URL may legitimately need no auth');

  // eslint-disable-next-line no-console
  console.log('models.ts self-check ok');
}
