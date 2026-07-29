import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { cfg } from '../lib/config-registry.js';
import { encrypt, decrypt, validTokenFormat } from '../lib/secret-box.js';
import { newId } from '../lib/ids.js';
import { getUserToken, getCommonToken } from './claude-token.js';

// LLM provider override. The Claude Agent SDK spawns the Claude CLI, which speaks the Anthropic wire
// format and natively supports these back-ends via env vars. A provider profile (per-user or common)
// is an ADDITIVE, higher-priority override over the default Anthropic-token path — when none is set,
// auth resolves exactly as before (resolveClaudeAuth). OpenAI/ChatGPT/local LLMs are reachable only
// through a translating proxy exposed at an Anthropic-compatible base URL (the 'custom' type).
export type ProviderType = 'anthropic' | 'bedrock' | 'vertex' | 'custom';
export type ProviderScope = 'user' | 'common';
export type ProviderSource = 'user' | 'common' | 'token' | 'none';

const COMMON_OWNER = ''; // common profile uses '' so the (scope, owner_id) unique index holds
const TYPES: ProviderType[] = ['anthropic', 'bedrock', 'vertex', 'custom'];

// Decrypted config: a flat bag of the fields each provider type needs (secrets + non-secrets).
export interface ProviderConfig {
  baseUrl?: string;      // custom: Anthropic-compatible base URL
  authToken?: string;    // custom bearer / anthropic Claude token
  apiKey?: string;       // anthropic API key (alias for authToken on the anthropic type)
  region?: string;       // bedrock AWS_REGION / vertex CLOUD_ML_REGION
  accessKeyId?: string;  // bedrock
  secretKey?: string;    // bedrock
  sessionToken?: string; // bedrock (temporary creds)
  bearerToken?: string;  // bedrock AWS_BEARER_TOKEN_BEDROCK (alternative to key pair)
  projectId?: string;    // vertex ANTHROPIC_VERTEX_PROJECT_ID
  model?: string;        // model id/ARN override (ANTHROPIC_MODEL + options.model)
}

// Map a decrypted config to the CLI's env vars for that provider. Returns an optional `model`
// override too. anthropic with no token → empty env (the resolver treats that as "use the token").
export function providerEnv(type: ProviderType, c: ProviderConfig): { env: Record<string, string>; model?: string } {
  const env: Record<string, string> = {};
  const model = c.model?.trim() || undefined;
  const s = (v?: string) => (v || '').trim();
  switch (type) {
    case 'anthropic': {
      // Just pins a Claude token. OAuth tokens (sk-ant-oat*) → CLAUDE_CODE_OAUTH_TOKEN; API keys via
      // ANTHROPIC_API_KEY — same rule buildOptions uses for the default token path.
      const tok = s(c.authToken) || s(c.apiKey);
      if (tok) {
        if (tok.startsWith('sk-ant-oat')) env.CLAUDE_CODE_OAUTH_TOKEN = tok;
        else env.ANTHROPIC_API_KEY = tok;
      }
      return { env }; // model stays the dropdown model for anthropic
    }
    case 'bedrock': {
      env.CLAUDE_CODE_USE_BEDROCK = '1';
      if (s(c.region)) env.AWS_REGION = s(c.region);
      if (s(c.bearerToken)) env.AWS_BEARER_TOKEN_BEDROCK = s(c.bearerToken);
      else {
        if (s(c.accessKeyId)) env.AWS_ACCESS_KEY_ID = s(c.accessKeyId);
        if (s(c.secretKey)) env.AWS_SECRET_ACCESS_KEY = s(c.secretKey);
        if (s(c.sessionToken)) env.AWS_SESSION_TOKEN = s(c.sessionToken);
      }
      if (model) env.ANTHROPIC_MODEL = model;
      return { env, model };
    }
    case 'vertex': {
      // Minimal: env flags + region/project. Relies on ambient/host GCP creds (ADC) — we don't manage them.
      env.CLAUDE_CODE_USE_VERTEX = '1';
      if (s(c.region)) env.CLOUD_ML_REGION = s(c.region);
      if (s(c.projectId)) env.ANTHROPIC_VERTEX_PROJECT_ID = s(c.projectId);
      if (model) env.ANTHROPIC_MODEL = model;
      return { env, model };
    }
    case 'custom': {
      if (s(c.baseUrl)) env.ANTHROPIC_BASE_URL = s(c.baseUrl);
      if (s(c.authToken)) env.ANTHROPIC_AUTH_TOKEN = s(c.authToken);
      if (model) env.ANTHROPIC_MODEL = model;
      return { env, model };
    }
  }
}

// Every env var any provider type can set — buildOptions clears ALL of these from the cloned host
// env before applying the resolved provider env, so a stray host-global var (e.g. an exported
// ANTHROPIC_BASE_URL or AWS creds) can never bleed into a default-token or mock turn.
export const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX',
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'AWS_REGION', 'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK', 'CLOUD_ML_REGION',
  'ANTHROPIC_VERTEX_PROJECT_ID',
] as const;

// Anthropic env from a raw Claude token (the token cases in resolveProvider).
const tokenEnv = (tok: string): Record<string, string> => providerEnv('anthropic', { authToken: tok }).env;

function getRow(scope: ProviderScope, ownerId: string) {
  const owner = scope === 'common' ? COMMON_OWNER : ownerId;
  return db.select().from(schema.llmProviders)
    .where(and(eq(schema.llmProviders.scope, scope), eq(schema.llmProviders.ownerId, owner))).get();
}

function decryptConfig(row: typeof schema.llmProviders.$inferSelect): ProviderConfig | null {
  try { return JSON.parse(decrypt(row.configEnc)) as ProviderConfig; }
  catch { return null; } // corrupt/rekeyed → treat as no profile
}

// Whose auth runs this turn. Order: user provider → user token → common provider → common token → none.
// forceMock (MOCK_CLAUDE) short-circuits to none, exactly like resolveClaudeAuth. Token cases reuse
// getUserToken/getCommonToken (which own the decrypt + env fallback) so nothing is duplicated.
export function resolveProvider(userId: string | null): { env: Record<string, string>; model?: string; source: ProviderSource } {
  if (cfg.bool('forceMock')) return { env: {}, source: 'none' };
  const fromRow = (scope: ProviderScope, owner: string, source: ProviderSource) => {
    const row = getRow(scope, owner);
    if (!row) return null;
    const c = decryptConfig(row); if (!c) return null;
    const { env, model } = providerEnv(row.type as ProviderType, c);
    // anthropic-with-no-token yields empty env → fall through to the token path ("use the Claude token").
    if (Object.keys(env).length === 0) return null;
    return { env, model, source };
  };
  if (userId) {
    const p = fromRow('user', userId, 'user'); if (p) return p;
    const tok = getUserToken(userId); if (tok) return { env: tokenEnv(tok), source: 'token' };
  }
  const cp = fromRow('common', COMMON_OWNER, 'common'); if (cp) return cp;
  const shared = getCommonToken(); if (shared) return { env: tokenEnv(shared), source: 'token' };
  return { env: {}, source: 'none' };
}

// ── CRUD (secrets never leave the server) ──

// Non-secret status for a profile: type + plaintext non-secrets + booleans for each secret field.
export interface ProviderStatus {
  type: ProviderType;
  fields: {
    baseUrl: string; region: string; projectId: string; model: string;
    hasAuthToken: boolean; hasApiKey: boolean; hasAccessKeyId: boolean;
    hasSecretKey: boolean; hasSessionToken: boolean; hasBearerToken: boolean;
  };
}

export function getProvider(scope: ProviderScope, ownerId: string): ProviderStatus | null {
  const row = getRow(scope, ownerId);
  if (!row) return null;
  const c = decryptConfig(row) || {};
  return {
    type: row.type as ProviderType,
    fields: {
      baseUrl: c.baseUrl || '', region: c.region || '', projectId: c.projectId || '', model: c.model || '',
      hasAuthToken: !!c.authToken, hasApiKey: !!c.apiKey, hasAccessKeyId: !!c.accessKeyId,
      hasSecretKey: !!c.secretKey, hasSessionToken: !!c.sessionToken, hasBearerToken: !!c.bearerToken,
    },
  };
}

// Validate the config for `type`, drop empties, and reject an obviously-broken profile.
function sanitize(type: ProviderType, raw: any): ProviderConfig {
  const s = (v: any) => (typeof v === 'string' ? v.trim() : '');
  const c: ProviderConfig = {};
  const put = (k: keyof ProviderConfig, v: string) => { if (v) (c as any)[k] = v; };
  put('model', s(raw?.model));
  if (type === 'anthropic') {
    const tok = s(raw?.authToken) || s(raw?.apiKey);
    if (tok && !validTokenFormat(tok)) throw new Error('anthropic: token must be sk-ant-oat… or sk-ant-api…');
    if (tok) c.authToken = tok; // stored under authToken; providerEnv routes by prefix
  } else if (type === 'custom') {
    put('baseUrl', s(raw?.baseUrl));
    put('authToken', s(raw?.authToken));
    if (!c.baseUrl) throw new Error('custom: base URL required (Anthropic-compatible endpoint)');
    if (!/^https?:\/\//i.test(c.baseUrl)) throw new Error('custom: base URL must start with http(s)://');
  } else if (type === 'bedrock') {
    put('region', s(raw?.region));
    put('bearerToken', s(raw?.bearerToken));
    put('accessKeyId', s(raw?.accessKeyId));
    put('secretKey', s(raw?.secretKey));
    put('sessionToken', s(raw?.sessionToken));
    if (!c.region) throw new Error('bedrock: AWS region required');
    if (!c.bearerToken && !(c.accessKeyId && c.secretKey)) {
      throw new Error('bedrock: provide a bearer token, or an access key id + secret key');
    }
  } else if (type === 'vertex') {
    put('region', s(raw?.region));
    put('projectId', s(raw?.projectId));
    if (!c.region) throw new Error('vertex: region (CLOUD_ML_REGION) required');
    if (!c.projectId) throw new Error('vertex: project id required');
  }
  return c;
}

export function setProvider(scope: ProviderScope, ownerId: string, type: any, config: any): ProviderStatus {
  if (!TYPES.includes(type)) throw new Error(`unknown provider type: ${type}`);
  const owner = scope === 'common' ? COMMON_OWNER : ownerId;
  const c = sanitize(type, config || {});
  const now = Date.now();
  const existing = getRow(scope, owner);
  const vals = { type, configEnc: encrypt(JSON.stringify(c)), updatedAt: now };
  if (existing) {
    db.update(schema.llmProviders).set(vals).where(eq(schema.llmProviders.id, existing.id)).run();
  } else {
    db.insert(schema.llmProviders).values({ id: newId(), scope, ownerId: owner, createdAt: now, ...vals }).run();
  }
  return getProvider(scope, owner)!;
}

export function clearProvider(scope: ProviderScope, ownerId: string): void {
  const owner = scope === 'common' ? COMMON_OWNER : ownerId;
  db.delete(schema.llmProviders)
    .where(and(eq(schema.llmProviders.scope, scope), eq(schema.llmProviders.ownerId, owner))).run();
}

// ── reasoning self-check (run once: PROVIDER_SELFCHECK=1 npx tsx server/src/auth/provider.ts) ──
if (process.env.PROVIDER_SELFCHECK) {
  const assert = (cond: boolean, m: string) => { if (!cond) throw new Error('providerEnv check failed: ' + m); };
  const bed = providerEnv('bedrock', { region: 'us-east-1', bearerToken: 'abc' }).env;
  assert(bed.CLAUDE_CODE_USE_BEDROCK === '1' && bed.AWS_REGION === 'us-east-1', 'bedrock → USE_BEDROCK + region');
  const cus = providerEnv('custom', { baseUrl: 'http://localhost:4000', authToken: 'sk-x' }).env;
  assert(cus.ANTHROPIC_BASE_URL === 'http://localhost:4000', 'custom → ANTHROPIC_BASE_URL set');
  const anth = providerEnv('anthropic', { apiKey: 'sk-ant-api-xyz' }).env;
  assert(anth.ANTHROPIC_API_KEY === 'sk-ant-api-xyz', 'anthropic → falls back to token env');
  assert(Object.keys(providerEnv('anthropic', {}).env).length === 0, 'anthropic empty → no env (use the token)');
  // eslint-disable-next-line no-console
  console.log('provider.ts self-check ok');
}
