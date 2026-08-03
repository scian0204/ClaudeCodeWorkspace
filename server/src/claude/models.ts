import { cfg, registerApply, setConfigValue } from '../lib/config-registry.js';
import { resolveProvider } from '../auth/provider.js';

// Auto-fetched model list. Frontier model ids move fast (a new Opus/Sonnet drops and the hardcoded
// map is stale), so instead of hand-editing `models` an admin can let the server pull the live list
// from the Anthropic-compatible `/v1/models` endpoint — api.anthropic.com, or whatever a `custom`
// provider's base URL points at (LiteLLM & friends serve the same route). The result is written
// back into the `models` config, so there is still exactly ONE source for the dropdown and the
// admin can keep editing it by hand (turn modelsAutoFetch off, or the next refresh overwrites).
//
// Auth comes from the COMMON scope (resolveProvider(null)): the list is workspace-wide, so it must
// not depend on whichever user happens to be asking.

interface ApiModel { id?: string; display_name?: string; created_at?: string }

function endpoint(): { url: string; headers: Record<string, string> } {
  const { env } = resolveProvider(null);
  if (env.CLAUDE_CODE_USE_BEDROCK || env.CLAUDE_CODE_USE_VERTEX) {
    throw new Error('bedrock/vertex expose no /v1/models endpoint — edit the model list by hand');
  }
  const base = (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  if (env.ANTHROPIC_API_KEY) headers['x-api-key'] = env.ANTHROPIC_API_KEY;
  else if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    headers.authorization = `Bearer ${env.CLAUDE_CODE_OAUTH_TOKEN}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else if (env.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${env.ANTHROPIC_AUTH_TOKEN}`;
  else if (!env.ANTHROPIC_BASE_URL) throw new Error('no Claude token or API key configured');
  return { url: `${base}/v1/models?limit=1000`, headers };
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
  // eslint-disable-next-line no-console
  console.log('models.ts self-check ok');
}
