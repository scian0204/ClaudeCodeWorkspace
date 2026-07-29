// Single source of truth for every admin-manageable setting. One definition array drives BOTH the
// admin API (GET/PUT /api/admin/config) and the admin UI. Value resolution is layered:
//   DB override (settings table) → env var → hardcoded default.
// Runtime-tunable values are read live at each use site via cfg.int/str/bool, so an admin edit
// applies without a restart (a few consumers register an applyLive hook to re-arm timers/semaphores).
//
// NOTE: this module MUST NOT be imported by config.ts — paths.ts reads config.dataDir at module load,
// so config.ts → registry → settings → db → paths → config.ts would be a TDZ import cycle at boot.
// config.ts stays pure-env; runtime consumers import `cfg` from here directly.
import { getSetting, setSetting, deleteSetting } from './settings.js';

const env = process.env;

export type ConfigType = 'bool' | 'int' | 'string' | 'select' | 'json';

export interface ConfigDef {
  key: string;          // DB settings key + API key
  group: string;        // UI group
  type: ConfigType;
  default: string;      // canonical string form of the hardcoded default
  env?: string;         // env var that seeds the default (before any DB override)
  restart?: boolean;    // only takes effect after a process restart (read once at boot)
  readonly?: boolean;   // display-only (infra/bootstrap) — never written from the UI, no DB override
  secret?: boolean;     // never expose the value; report set/unset status only
  min?: number;         // int lower bound (clamped)
  max?: number;         // int upper bound (clamped)
  options?: string[];   // select choices
  unit?: string;        // UI hint: 'ms' | 'MB' | 'days' | 'bytes' | ''
  image?: boolean;      // docker image value → UI offers presence check + pull/update
}

const DEFAULT_MODELS = '{"claude-opus-4-8":"Opus 4.8","claude-sonnet-5":"Sonnet 5","claude-haiku-4-5-20251001":"Haiku 4.5"}';

// ── the registry ──
export const DEFS: ConfigDef[] = [
  // Claude / turns
  { key: 'defaultModel', group: 'claude', type: 'select', default: 'claude-opus-4-8',
    options: ['claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-fable-5'] },
  { key: 'defaultEffort', group: 'claude', type: 'select', default: 'high',
    options: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { key: 'models', group: 'claude', type: 'json', default: DEFAULT_MODELS },
  { key: 'forceMock', group: 'claude', type: 'bool', default: '0', env: 'MOCK_CLAUDE' },
  { key: 'maxConcurrentTurns', group: 'claude', type: 'int', default: '3', env: 'MAX_CONCURRENT_TURNS', min: 1, max: 100 },
  { key: 'turnMaxRetries', group: 'claude', type: 'int', default: '5', min: 0, max: 20 },
  { key: 'turnBackoffBaseMs', group: 'claude', type: 'int', default: '1000', min: 100, max: 60000, unit: 'ms' },
  { key: 'turnBackoffCapMs', group: 'claude', type: 'int', default: '30000', min: 1000, max: 600000, unit: 'ms' },
  { key: 'usageProbeTtlMs', group: 'claude', type: 'int', default: '15000', min: 1000, max: 600000, unit: 'ms' },
  { key: 'usageProbeTimeoutMs', group: 'claude', type: 'int', default: '8000', min: 1000, max: 120000, unit: 'ms' },

  // PR review pipeline
  { key: 'reviewAuto', group: 'review', type: 'bool', default: '1', env: 'REVIEW_AUTO' },
  { key: 'reviewComment', group: 'review', type: 'bool', default: '1', env: 'REVIEW_COMMENT' },
  { key: 'reviewPollMs', group: 'review', type: 'int', default: '60000', env: 'REVIEW_POLL_MS', min: 0, max: 86400000, unit: 'ms' },
  { key: 'reviewTurnTimeoutMs', group: 'review', type: 'int', default: '1800000', env: 'REVIEW_TURN_TIMEOUT_MS', min: 60000, max: 7200000, unit: 'ms' },
  { key: 'reviewMaxRetries', group: 'review', type: 'int', default: '2', min: 0, max: 10 },
  { key: 'reviewSandboxImage', group: 'review', type: 'string', default: 'node:20-bookworm', env: 'REVIEW_SANDBOX_IMAGE', image: true },
  { key: 'reviewSandboxMemMB', group: 'review', type: 'int', default: '4096', env: 'REVIEW_SANDBOX_MEM_MB', min: 256, max: 131072, unit: 'MB' },
  { key: 'reviewSandboxExecTimeoutMs', group: 'review', type: 'int', default: '300000', env: 'REVIEW_SANDBOX_EXEC_TIMEOUT_MS', min: 10000, max: 3600000, unit: 'ms' },
  { key: 'reviewSandboxPidsLimit', group: 'review', type: 'int', default: '1024', min: 64, max: 65536 },
  { key: 'reviewSandboxMaxOutputBytes', group: 'review', type: 'int', default: '60000', min: 1000, max: 5000000, unit: 'bytes' },
  { key: 'reviewMaxOpenPrs', group: 'review', type: 'int', default: '100', min: 1, max: 100 },
  { key: 'reviewHttpTimeoutMs', group: 'review', type: 'int', default: '20000', min: 1000, max: 300000, unit: 'ms' },

  // git operations
  { key: 'gitOpTimeoutMs', group: 'git', type: 'int', default: '120000', min: 5000, max: 3600000, unit: 'ms' },
  { key: 'gitNetworkTimeoutMs', group: 'git', type: 'int', default: '300000', min: 10000, max: 3600000, unit: 'ms' },
  { key: 'gitMaxBufferMB', group: 'git', type: 'int', default: '8', min: 1, max: 512, unit: 'MB' },
  { key: 'git_author_domain', group: 'git', type: 'string', default: 'ccw.local' },

  // code-server editors
  { key: 'codeServerImage', group: 'codeserver', type: 'string', default: 'codercom/code-server:latest', env: 'CODE_SERVER_IMAGE', image: true },
  { key: 'codeServerIdleMs', group: 'codeserver', type: 'int', default: '1800000', env: 'CODE_SERVER_IDLE_MS', min: 60000, max: 86400000, unit: 'ms' },
  { key: 'codeServerReaperMs', group: 'codeserver', type: 'int', default: '60000', min: 10000, max: 3600000, unit: 'ms' },
  { key: 'codeServerWaitReadyMs', group: 'codeserver', type: 'int', default: '30000', min: 5000, max: 300000, unit: 'ms' },

  // auth
  { key: 'sessionTtlDays', group: 'auth', type: 'int', default: '30', min: 1, max: 365, unit: 'days' },
  { key: 'allow_bypass', group: 'auth', type: 'bool', default: '1' },

  // feature flags (live — toggle without restart)
  { key: 'sessionImportEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'resourceCleanupEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'llmProvidersEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'avatarMaxMB', group: 'features', type: 'int', default: '5', min: 1, max: 50, unit: 'MB' },
  { key: 'attachmentMaxMB', group: 'features', type: 'int', default: '20', min: 1, max: 200, unit: 'MB' },
  { key: 'attachmentMaxCount', group: 'features', type: 'int', default: '10', min: 1, max: 50 },

  // server limits (read once at server construction → restart to apply)
  { key: 'httpBodyLimitMB', group: 'server', type: 'int', default: '6', min: 1, max: 1024, unit: 'MB', restart: true },
  { key: 'uploadMaxMB', group: 'server', type: 'int', default: '200', min: 1, max: 4096, unit: 'MB', restart: true },
  { key: 'socketMaxMB', group: 'server', type: 'int', default: '5', min: 1, max: 1024, unit: 'MB', restart: true },
  { key: 'claudeCodePath', group: 'server', type: 'string', default: '', env: 'CLAUDE_CODE_PATH' },

  // infrastructure (env-only, read-only display: a UI living in the DB can't relocate the DB)
  { key: 'port', group: 'infra', type: 'int', default: '3000', env: 'PORT', readonly: true, restart: true },
  { key: 'dataDir', group: 'infra', type: 'string', default: './data', env: 'DATA_DIR', readonly: true, restart: true },
  { key: 'bindHost', group: 'infra', type: 'string', default: '0.0.0.0', readonly: true, restart: true },
  { key: 'tlsKey', group: 'infra', type: 'string', default: '', env: 'TLS_KEY', readonly: true, restart: true },
  { key: 'tlsCert', group: 'infra', type: 'string', default: '', env: 'TLS_CERT', readonly: true, restart: true },
  { key: 'codeServerNetwork', group: 'infra', type: 'string', default: '', env: 'CODE_SERVER_NETWORK', readonly: true, restart: true },
  { key: 'dataVolume', group: 'infra', type: 'string', default: '', env: 'DATA_VOLUME', readonly: true, restart: true },
  { key: 'bootstrapAdminUser', group: 'infra', type: 'string', default: 'admin', env: 'BOOTSTRAP_ADMIN_USER', readonly: true, restart: true },

  // secrets (env-only, status only — value never leaves the server)
  { key: 'sessionSecret', group: 'secret', type: 'string', default: 'change-me-please', env: 'SESSION_SECRET', secret: true, readonly: true, restart: true },
  { key: 'tokenEncSecret', group: 'secret', type: 'string', default: '', env: 'TOKEN_ENC_SECRET', secret: true, readonly: true, restart: true },
  { key: 'anthropicApiKey', group: 'secret', type: 'string', default: '', env: 'ANTHROPIC_API_KEY', secret: true, readonly: true, restart: true },
];

const byKey = new Map(DEFS.map((d) => [d.key, d]));
function mustDef(key: string): ConfigDef {
  const d = byKey.get(key);
  if (!d) throw new Error(`unknown config key: ${key}`);
  return d;
}

const SENTINEL = ' __ccw_unset__';
function envValue(d: ConfigDef): string {
  if (d.env && env[d.env] != null && env[d.env] !== '') return String(env[d.env]);
  return d.default;
}

// resolved string value: DB override (editable keys only) → env → default
function resolve(key: string): string {
  const d = mustDef(key);
  if (!d.readonly) {
    const dbv = getSetting(key, SENTINEL);
    if (dbv !== SENTINEL) return dbv;
  }
  return envValue(d);
}

// small cache; cleared wholesale on any write (values re-resolve lazily)
const cache = new Map<string, string>();
function cached(key: string): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = resolve(key);
  cache.set(key, v);
  return v;
}

function toBool(s: string): boolean {
  const v = s.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export const cfg = {
  str: (key: string): string => cached(key),
  int: (key: string): number => {
    const n = Number(cached(key));
    return Number.isFinite(n) ? n : Number(mustDef(key).default) || 0;
  },
  bool: (key: string): boolean => toBool(cached(key)),
};

// ── applyLive: consumers register a hook to re-arm live state (semaphore/timers) after an edit.
// Registration is push (module → registry) to avoid registry importing those modules (cycle-free).
const applyHooks = new Map<string, (v: string) => void>();
export function registerApply(key: string, fn: (v: string) => void) { applyHooks.set(key, fn); }

// ── validation / normalization ──
function normalize(d: ConfigDef, raw: unknown): string {
  const s = raw == null ? '' : String(raw);
  switch (d.type) {
    case 'bool':
      return toBool(s) ? '1' : '0';
    case 'int': {
      let n = Math.round(Number(s));
      if (!Number.isFinite(n)) throw new Error(`${d.key}: not a number`);
      if (d.min != null && n < d.min) n = d.min;
      if (d.max != null && n > d.max) n = d.max;
      return String(n);
    }
    case 'select':
      if (d.options && !d.options.includes(s)) throw new Error(`${d.key}: '${s}' not an allowed option`);
      return s;
    case 'json':
      try { JSON.parse(s); } catch { throw new Error(`${d.key}: invalid JSON`); }
      return s;
    default:
      return s.trim();
  }
}

export function setConfigValue(key: string, value: unknown): void {
  const d = mustDef(key);
  if (d.readonly) throw new Error(`${key} is read-only (edit .env and restart)`);
  const norm = normalize(d, value);
  setSetting(key, norm);
  cache.clear();
  applyHooks.get(key)?.(norm);
}

// Drop the DB override → revert to env/default.
export function resetConfigValue(key: string): void {
  const d = mustDef(key);
  if (d.readonly) throw new Error(`${key} is read-only`);
  deleteSetting(key);
  cache.clear();
  applyHooks.get(key)?.(resolve(key));
}

// ── API projection ──
export interface ConfigItemDto {
  key: string; group: string; type: ConfigType; unit?: string;
  restart: boolean; readonly: boolean; secret: boolean;
  min?: number; max?: number; options?: string[]; image?: boolean;
  default: string; overridden: boolean;
  value?: string;   // omitted for secrets
  set?: boolean;    // secrets only: is a non-default value configured
}

export function listConfigForApi(): ConfigItemDto[] {
  return DEFS.map((d): ConfigItemDto => {
    const val = resolve(d.key);
    const overridden = !d.readonly && getSetting(d.key, SENTINEL) !== SENTINEL;
    const base: ConfigItemDto = {
      key: d.key, group: d.group, type: d.type, unit: d.unit,
      restart: !!d.restart, readonly: !!d.readonly, secret: !!d.secret,
      min: d.min, max: d.max, options: d.options, image: !!d.image,
      default: d.default, overridden,
    };
    if (d.secret) return { ...base, set: val !== '' && val !== d.default };
    return { ...base, value: val };
  });
}

// Current values of every image-typed setting — the allowlist for admin image pull/inspect,
// so an admin can only act on images the app actually uses.
export function imageConfigValues(): string[] {
  return DEFS.filter((d) => d.image).map((d) => resolve(d.key)).filter(Boolean);
}

// Client-facing subset (any authed user): drives the model dropdown.
export function publicConfig(): { models: Record<string, string>; defaultModel: string; defaultEffort: string; sessionImportEnabled: boolean; llmProvidersEnabled: boolean } {
  let models: Record<string, string>;
  try { models = JSON.parse(cfg.str('models')); } catch { models = JSON.parse(DEFAULT_MODELS); }
  return { models, defaultModel: cfg.str('defaultModel'), defaultEffort: cfg.str('defaultEffort'), sessionImportEnabled: cfg.bool('sessionImportEnabled'), llmProvidersEnabled: cfg.bool('llmProvidersEnabled') };
}
