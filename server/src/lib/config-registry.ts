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
  disabledWhen?: string; // bool key that overrides this one — UI locks the row while that key is on
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
  { key: 'modelsAutoFetch', group: 'claude', type: 'bool', default: '1' },
  { key: 'modelsRefreshMs', group: 'claude', type: 'int', default: '86400000', min: 60000, max: 2592000000, unit: 'ms' },
  { key: 'modelsMax', group: 'claude', type: 'int', default: '8', min: 1, max: 100 },
  { key: 'modelsFetchTimeoutMs', group: 'claude', type: 'int', default: '10000', min: 1000, max: 120000, unit: 'ms' },
  { key: 'forceMock', group: 'claude', type: 'bool', default: '0', env: 'MOCK_CLAUDE' },
  { key: 'maxConcurrentTurns', group: 'claude', type: 'int', default: '3', env: 'MAX_CONCURRENT_TURNS', min: 1, max: 100 },
  { key: 'turnMaxRetries', group: 'claude', type: 'int', default: '5', min: 0, max: 20 },
  { key: 'turnBackoffBaseMs', group: 'claude', type: 'int', default: '1000', min: 100, max: 60000, unit: 'ms' },
  { key: 'turnBackoffCapMs', group: 'claude', type: 'int', default: '30000', min: 1000, max: 600000, unit: 'ms' },
  { key: 'autoTitleEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'autoTitleModel', group: 'claude', type: 'string', default: 'claude-haiku-4-5-20251001' },
  { key: 'autoTitleMaxChars', group: 'claude', type: 'int', default: '40', min: 10, max: 120 },
  { key: 'autoTitleTimeoutMs', group: 'claude', type: 'int', default: '20000', min: 2000, max: 120000, unit: 'ms' },
  // same naming pass for chats cloned by the local-session import (one call per session, so it is
  // separately switchable — a 50-session import means 50 calls)
  { key: 'importAutoTitleEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'importAutoTitleMessages', group: 'claude', type: 'int', default: '6', min: 1, max: 30 },
  { key: 'usageProbeTtlMs', group: 'claude', type: 'int', default: '15000', min: 1000, max: 600000, unit: 'ms' },
  { key: 'usageProbeTimeoutMs', group: 'claude', type: 'int', default: '8000', min: 1000, max: 120000, unit: 'ms' },
  // auto-resume a turn that hit the claude.ai plan window (5h / weekly), once the window resets
  { key: 'autoResumeEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'autoResumeGraceMs', group: 'claude', type: 'int', default: '60000', min: 0, max: 3600000, unit: 'ms' },
  { key: 'autoResumeMaxAttempts', group: 'claude', type: 'int', default: '3', min: 1, max: 10 },
  { key: 'autoResumeMaxPending', group: 'claude', type: 'int', default: '20', min: 1, max: 200 },
  { key: 'autoResumeStaleMs', group: 'claude', type: 'int', default: '21600000', min: 60000, max: 604800000, unit: 'ms' },
  // 5h-window primer: open a new claude.ai window with a tiny throwaway query as soon as none runs
  { key: 'windowPrimerEnabled', group: 'claude', type: 'bool', default: '1' },
  { key: 'windowPrimerModel', group: 'claude', type: 'string', default: 'claude-haiku-4-5-20251001' },
  { key: 'windowPrimerPrompt', group: 'claude', type: 'string', default: 'Reply with exactly: ok' },
  { key: 'windowPrimerGraceMs', group: 'claude', type: 'int', default: '60000', min: 0, max: 3600000, unit: 'ms' },
  { key: 'windowPrimerRetryMs', group: 'claude', type: 'int', default: '900000', min: 60000, max: 21600000, unit: 'ms' },
  { key: 'windowPrimerTimeoutMs', group: 'claude', type: 'int', default: '20000', min: 2000, max: 120000, unit: 'ms' },

  // privacy — non-essential egress to Anthropic (the inference call itself is never affected).
  // Every key here means the same thing: on = blocked. The master switch OVERRIDES the channel keys
  // (on = block everything), so they are locked in the UI while it is on. See privacy.ts for the env.
  { key: 'blockNonessentialTraffic', group: 'privacy', type: 'bool', default: '1', env: 'BLOCK_NONESSENTIAL_TRAFFIC' },
  ...(['privacyTelemetry', 'privacyErrorReports', 'privacyFeedbackCommands', 'privacyFeedbackSurvey',
       'privacyNonEssentialModelCalls', 'privacyAutoUpdater', 'privacyWebFetchPreflight',
       'privacyArtifact', 'privacyMarketplace'] as const).map((key): ConfigDef =>
    ({ key, group: 'privacy', type: 'bool', default: '1', disabledWhen: 'blockNonessentialTraffic' })),

  // PR review pipeline
  { key: 'reviewAuto', group: 'review', type: 'bool', default: '1', env: 'REVIEW_AUTO' },
  { key: 'reviewComment', group: 'review', type: 'bool', default: '1', env: 'REVIEW_COMMENT' },
  { key: 'reviewWebhook', group: 'review', type: 'bool', default: '1', env: 'REVIEW_WEBHOOK' },
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
  // publish: git init an untracked project and push it to a repo created through the provider API
  { key: 'gitPublishEnabled', group: 'git', type: 'bool', default: '1' },
  { key: 'gitInitBranch', group: 'git', type: 'string', default: 'main' },

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
  { key: 'approvalsEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'dmEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'customContextMenu', group: 'features', type: 'bool', default: '1' },
  // count skill invocations per user (shown in a plugin's skill detail); off = stop counting AND hide
  { key: 'skillUsageEnabled', group: 'features', type: 'bool', default: '1' },
  { key: 'processPollMs', group: 'features', type: 'int', default: '5000', min: 1000, max: 60000, unit: 'ms' },
  { key: 'avatarMaxMB', group: 'features', type: 'int', default: '5', min: 1, max: 50, unit: 'MB' },
  { key: 'attachmentMaxMB', group: 'features', type: 'int', default: '20', min: 1, max: 200, unit: 'MB' },
  { key: 'attachmentMaxCount', group: 'features', type: 'int', default: '10', min: 1, max: 50 },

  // branding — the workspace name + logo shown in the sidebar, login card, landing screen, browser tab.
  // Empty title = the built-in product name. The logo itself is a FILE (<dataDir>/brand/logo.<ext>,
  // uploaded through /api/admin/brand/logo), so only the text lives here.
  { key: 'brandTitle', group: 'brand', type: 'string', default: '', env: 'BRAND_TITLE' },
  { key: 'brandLogoMaxMB', group: 'brand', type: 'int', default: '2', min: 1, max: 20, unit: 'MB' },

  // LLM wiki — admins editing an existing topic's raw/ sources (add files / edit in place).
  // off = the endpoints 403 AND the explorer's edit affordances disappear.
  { key: 'wikiSourceEditEnabled', group: 'wiki', type: 'bool', default: '1' },
  { key: 'wikiEditMaxKB', group: 'wiki', type: 'int', default: '512', min: 1, max: 10240, unit: 'KB' },

  // workspace-wide search (routes/search.ts) — off hard-404s the endpoint AND hides the UI
  { key: 'searchEnabled', group: 'search', type: 'bool', default: '1' },
  { key: 'searchMaxPerType', group: 'search', type: 'int', default: '8', min: 1, max: 100 },
  { key: 'searchFileMaxKB', group: 'search', type: 'int', default: '512', min: 1, max: 10240, unit: 'KB' },
  { key: 'searchScanMaxFiles', group: 'search', type: 'int', default: '2000', min: 10, max: 100000 },

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

// `defaultModel` picks from the live model map (hand-edited or auto-fetched — see claude/models.ts),
// so its choices can't be a frozen array: a model id that only exists after a fetch must be settable.
// The registry defaults stay in the union as a floor for when the map is empty/broken.
function optionsFor(d: ConfigDef): string[] | undefined {
  if (d.key !== 'defaultModel') return d.options;
  return [...new Set([...Object.keys(modelMap()), ...(d.options || [])])];
}

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
    case 'select': {
      const opts = optionsFor(d);
      if (opts && !opts.includes(s)) throw new Error(`${d.key}: '${s}' not an allowed option`);
      return s;
    }
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
  min?: number; max?: number; options?: string[]; image?: boolean; disabledWhen?: string;
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
      min: d.min, max: d.max, options: optionsFor(d), image: !!d.image, disabledWhen: d.disabledWhen,
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

// The (model id → display name) map behind the chat dropdown. Corrupt JSON falls back to the default.
export function modelMap(): Record<string, string> {
  try {
    const m = JSON.parse(cfg.str('models'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : JSON.parse(DEFAULT_MODELS);
  } catch { return JSON.parse(DEFAULT_MODELS); }
}

// Client-facing subset (any authed user): drives the model dropdown.
export function publicConfig(): { models: Record<string, string>; defaultModel: string; defaultEffort: string; sessionImportEnabled: boolean; llmProvidersEnabled: boolean; approvalsEnabled: boolean; dmEnabled: boolean; searchEnabled: boolean; customContextMenu: boolean; autoTitleEnabled: boolean; autoResumeEnabled: boolean; windowPrimerEnabled: boolean; gitPublishEnabled: boolean; wikiSourceEditEnabled: boolean; reviewWebhookEnabled: boolean; processPollMs: number } {
  return { models: modelMap(), defaultModel: cfg.str('defaultModel'), defaultEffort: cfg.str('defaultEffort'), sessionImportEnabled: cfg.bool('sessionImportEnabled'), llmProvidersEnabled: cfg.bool('llmProvidersEnabled'), approvalsEnabled: cfg.bool('approvalsEnabled'), dmEnabled: cfg.bool('dmEnabled'), searchEnabled: cfg.bool('searchEnabled'), customContextMenu: cfg.bool('customContextMenu'), autoTitleEnabled: cfg.bool('autoTitleEnabled'), autoResumeEnabled: cfg.bool('autoResumeEnabled'), windowPrimerEnabled: cfg.bool('windowPrimerEnabled'), gitPublishEnabled: cfg.bool('gitPublishEnabled'), wikiSourceEditEnabled: cfg.bool('wikiSourceEditEnabled'), reviewWebhookEnabled: cfg.bool('reviewWebhook'), processPollMs: cfg.int('processPollMs') };
}
