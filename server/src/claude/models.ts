import { cfg, registerApply, setConfigValue } from '../lib/config-registry.js';
import { resolveProvider, PROVIDER_ENV_KEYS } from '../auth/provider.js';
import { applyPrivacyEnv, privacyPlan } from './privacy.js';
import { paths } from '../lib/paths.js';

// Auto-fetched model list. Frontier model ids move fast (a new Opus/Sonnet drops and the hardcoded
// map is stale), so instead of hand-editing `models` an admin can let the server pull the live list
// from the Anthropic-compatible `/v1/models` endpoint — api.anthropic.com, or whatever a `custom`
// provider's base URL points at (LiteLLM & friends serve the same route). The result is written
// back into the `models` config, so there is still exactly ONE source for the dropdown and the
// admin can keep editing it by hand (turn modelsAutoFetch off, or the next refresh overwrites).
//
// Auth comes from the COMMON scope (resolveProvider(null)): the list is workspace-wide, so it must
// not depend on whichever user happens to be asking. A pasted token or API key is sent as a header
// here. A BROWSER SIGN-IN is not: it leaves no token to send (see fetchViaCli), so that case asks
// the Claude CLI for the list instead of calling the endpoint at all.

interface ApiModel { id?: string; display_name?: string; created_at?: string }

// Which credential the request carries, from the resolved provider env.
export function authHeaders(env: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  if (env.ANTHROPIC_API_KEY) headers['x-api-key'] = env.ANTHROPIC_API_KEY;
  else if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    headers.authorization = `Bearer ${env.CLAUDE_CODE_OAUTH_TOKEN}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else if (env.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`;
  else if (!env.ANTHROPIC_BASE_URL) throw new Error('no Claude token or API key configured');
  return headers;
}

function endpoint(env: Record<string, string>): { url: string; headers: Record<string, string> } {
  const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  return { url: `${base}/v1/models?limit=1000`, headers: authHeaders(env) };
}

// ── the browser-sign-in path ──
// A browser sign-in is the one resolved env with nothing sendable in it — no token, just the folder
// the Claude CLI keeps the account's credential in. Anything else (a pasted key/token, or a custom
// endpoint that may need no auth at all) still goes over HTTP, so those lists do not change.
export const viaCli = (env: Record<string, string>): boolean =>
  !env.ANTHROPIC_API_KEY && !env.CLAUDE_CODE_OAUTH_TOKEN && !env.ANTHROPIC_AUTH_TOKEN
  && !env.ANTHROPIC_BASE_URL && !!env.CLAUDE_SECURESTORAGE_CONFIG_DIR;

// Reading that credential file directly is not a fix: the access token in it goes stale within
// hours, and the CLI — not this server — is what renews it, so an account that has not chatted
// recently would get a 401 instead of a list. So ask the CLI. A session whose prompt never yields
// lets us read its control channel and abort before any model turn: nothing is spent, and the answer
// is exactly the model menu the CLI itself offers for this account.
async function* idlePrompt(): AsyncGenerator<never> { await new Promise(() => { /* until abort */ }); }

async function fetchViaCli(providerEnv: Record<string, string>): Promise<Record<string, string>> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  // Same env hygiene buildOptions applies to a real turn: drop every provider-controlled var a host
  // global might have set, lay the resolved one on top, then close the non-essential channels.
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const k of PROVIDER_ENV_KEYS) delete env[k];
  Object.assign(env, providerEnv);
  applyPrivacyEnv(env, privacyPlan((k) => cfg.bool(k)));

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), cfg.int('modelsCliTimeoutMs'));
  try {
    const q: any = query({
      prompt: idlePrompt() as any,
      options: {
        cwd: paths.common, env, abortController: abort,
        settingSources: [], // a workspace-wide lookup must not inherit anyone's personal settings
        canUseTool: async () => ({ behavior: 'deny', message: 'probe' }),
      } as any,
    });
    const rows: any[] = (await q.supportedModels()) || [];
    const out = rows
      .filter((m) => m?.value)
      .slice(0, cfg.int('modelsMax'))
      .map((m) => [String(m.value), String(m.displayName || m.value).trim()] as const);
    if (!out.length) throw new Error('no models returned');
    return Object.fromEntries(out);
  } finally {
    clearTimeout(timer);
    try { abort.abort(); } catch { /* already gone */ }
  }
}

// "Claude Opus 4.1" → "Opus 4.1" (the chat pill is narrow); no display_name → the raw id.
const label = (m: ApiModel): string => (m.display_name || '').replace(/^Claude\s+/i, '').trim() || String(m.id);

// Newest `modelsMax` models as an (id → label) map. Anthropic already returns newest-first; a proxy
// may not, so re-sort on created_at when it is there (all-missing → localeCompare 0 → API order).
export async function fetchModels(): Promise<Record<string, string>> {
  const { env } = resolveProvider(null);
  if (env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX) {
    throw new Error('bedrock/vertex expose no /v1/models endpoint — edit the model list by hand');
  }
  if (viaCli(env)) return fetchViaCli(env);
  const { url, headers } = endpoint(env);
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

  // auth header selection for the paths that carry one
  assert(authHeaders({ ANTHROPIC_API_KEY: 'sk-ant-api-1' })['x-api-key'] === 'sk-ant-api-1', 'api key → x-api-key');
  const oat = authHeaders({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-1' });
  assert(oat.authorization === 'Bearer sk-ant-oat-1' && oat['anthropic-beta'] === 'oauth-2025-04-20',
    'oauth token → bearer + the oauth beta header');
  assert(!authHeaders({ ANTHROPIC_BASE_URL: 'http://proxy' }).authorization,
    'a custom base URL may legitimately need no auth');
  let threw = false;
  try { authHeaders({}); } catch { threw = true; }
  assert(threw, 'nothing configured at all is an error, not an unauthenticated call');

  // routing: only a bare sign-in store (no token, no base URL) goes to the CLI
  assert(viaCli({ CLAUDE_SECURESTORAGE_CONFIG_DIR: '/store' }), 'browser sign-in → ask the CLI');
  assert(!viaCli({ ANTHROPIC_API_KEY: 'k', CLAUDE_SECURESTORAGE_CONFIG_DIR: '/store' }), 'a pasted key still goes over HTTP');
  assert(!viaCli({ ANTHROPIC_BASE_URL: 'http://proxy' }), 'a custom endpoint keeps its own /v1/models list');

  // eslint-disable-next-line no-console
  console.log('models.ts self-check ok');
}
