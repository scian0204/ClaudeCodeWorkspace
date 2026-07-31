// Non-essential Anthropic egress kill-switch.
//
// The inference call itself (prompts + model output → api.anthropic.com or whatever
// ANTHROPIC_BASE_URL points at) is the product and is NOT touched here — swap it out with the
// LLM Provider `custom` setting if you want a fully local stack. Everything ELSE the Claude Code
// CLI can send home is switched off by the vars below.
//
// Source of truth: https://code.claude.com/docs/en/data-usage#telemetry-services
//   • metrics (latency/usage patterns) ......... DISABLE_TELEMETRY
//   • error reports (stack traces) ............. DISABLE_ERROR_REPORTING
//   • /feedback · /bug · /share (ships the whole transcript, code included)
//   • "How is Claude doing this session?" survey + its transcript-upload follow-up
//   • extra non-essential model round-trips (titles/flavour text)
//   • auto-updater version pings + downloads
//   • WebFetch preflight (sends the requested hostname to api.anthropic.com — NOT covered by
//     CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, only by the skipWebFetchPreflight setting)
//   • Artifact publishing (uploads page content to claude.ai)
//   • official plugin marketplace auto-install
export const PRIVACY_ENV: Record<string, string> = {
  // umbrella switch — also kills the survey, error reports and the updater on its own
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  // ...and each one individually, so a future change to the umbrella's scope can't reopen a channel
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  DISABLE_FEEDBACK_COMMAND: '1',
  DISABLE_BUG_COMMAND: '1',
  CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
  DISABLE_NON_ESSENTIAL_MODEL_CALLS: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_DOCTOR_COMMAND: '1',
  CLAUDE_CODE_DISABLE_ARTIFACT: '1',
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
  DO_NOT_TRACK: '1', // cross-vendor signal; also independently disables the survey
  // OpenTelemetry: off, and every content-bearing log flag pinned to 0 in case it is turned back on
  CLAUDE_CODE_ENABLE_TELEMETRY: '0',
  CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '0',
  ENABLE_ENHANCED_TELEMETRY_BETA: '0',
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
  OTEL_METRICS_EXPORTER: 'none',
  OTEL_LOGS_EXPORTER: 'none',
  OTEL_TRACES_EXPORTER: 'none',
  OTEL_LOG_USER_PROMPTS: '0',
  OTEL_LOG_ASSISTANT_RESPONSES: '0',
  OTEL_LOG_TOOL_DETAILS: '0',
  OTEL_LOG_TOOL_CONTENT: '0',
  OTEL_LOG_RAW_API_BODIES: '0',
};

// Vars we do NOT set but must remove: an inherited endpoint/header/opt-back-in from the host env
// could otherwise still ship data somewhere once any exporter is (re-)enabled.
export const PRIVACY_STRIP_ENV = [
  'BETA_TRACING_ENDPOINT',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL',
  'CLAUDE_CODE_PROPAGATE_TRACEPARENT',
] as const;

// The one privacy knob that is a *setting*, not an env var: WebFetch otherwise sends the hostname
// it is about to fetch to api.anthropic.com for a blocklist check. Passed via the SDK's `settings`
// (flag-settings layer) so nothing has to be written into the user's ~/.claude/settings.json.
export const PRIVACY_SETTINGS = { skipWebFetchPreflight: true } as const;

// Mutate a child-process env in place: strip the leak-back vars, then pin the opt-outs.
export function applyPrivacyEnv(env: Record<string, string | undefined>): void {
  for (const k of PRIVACY_STRIP_ENV) delete env[k];
  Object.assign(env, PRIVACY_ENV);
}

// `KEY=value` form for `docker createContainer({ Env })`.
export function privacyEnvList(): string[] {
  return Object.entries(PRIVACY_ENV).map(([k, v]) => `${k}=${v}`);
}

// ── self-check (run once: PRIVACY_SELFCHECK=1 npx tsx server/src/claude/privacy.ts) ──
if (process.env.PRIVACY_SELFCHECK) {
  const assert = (cond: boolean, m: string) => { if (!cond) throw new Error('privacy check failed: ' + m); };
  const env: Record<string, string | undefined> = {
    HOME: '/data/users/u1',
    DISABLE_TELEMETRY: '0',                             // hostile host value must be overridden
    BETA_TRACING_ENDPOINT: 'https://collector.example', // inherited endpoint must be removed
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer x',
  };
  applyPrivacyEnv(env);
  assert(env.DISABLE_TELEMETRY === '1', 'host DISABLE_TELEMETRY=0 overridden to 1');
  assert(!('BETA_TRACING_ENDPOINT' in env), 'inherited tracing endpoint stripped');
  assert(!('OTEL_EXPORTER_OTLP_HEADERS' in env), 'inherited OTLP headers stripped');
  assert(env.HOME === '/data/users/u1', 'unrelated env untouched');
  assert(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1', 'umbrella switch set');
  assert(privacyEnvList().includes('DO_NOT_TRACK=1'), 'docker Env list carries the same vars');
  assert(PRIVACY_SETTINGS.skipWebFetchPreflight === true, 'WebFetch preflight skipped');
  // eslint-disable-next-line no-console
  console.log('privacy.ts self-check ok');
}
