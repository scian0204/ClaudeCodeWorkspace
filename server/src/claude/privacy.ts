// Non-essential Anthropic egress kill-switch.
//
// The inference call itself (prompts + model output → api.anthropic.com or whatever
// ANTHROPIC_BASE_URL points at) is the product and is NOT touched here — swap it out with the
// LLM Provider `custom` setting if you want a fully local stack. Everything ELSE the Claude Code
// CLI can send home is switched off, channel by channel, below.
//
// Source of truth: https://code.claude.com/docs/en/data-usage#telemetry-services
//
// Two layers of admin control. The master switch (`blockNonessentialTraffic`) is an OVERRIDE, not a
// gate: on = every channel is blocked and the per-channel keys are ignored (the admin panel greys
// them out). Turn it off to pick channel by channel — e.g. let metrics through to your own OTel
// collector while the rest stay blocked. Every key means the same thing: on = blocked.

export const PRIVACY_MASTER = 'blockNonessentialTraffic';

export interface PrivacyChannel {
  key: string;                          // admin config key (registered in config-registry DEFS)
  env: Record<string, string>;          // vars pinned into the child env when the channel is on
  strip?: string[];                     // inherited vars deleted from the child env when on
  settings?: Record<string, unknown>;   // merged into the SDK's flag-settings layer when on
  umbrella?: boolean;                   // also covered by CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
}

export const PRIVACY_CHANNELS: PrivacyChannel[] = [
  {
    // Usage/latency metrics + the whole OpenTelemetry pipe. The OTEL_LOG_* flags are pinned to 0 so
    // that even a re-enabled exporter can never carry prompts, responses or tool payloads.
    key: 'privacyTelemetry', umbrella: true,
    env: {
      DISABLE_TELEMETRY: '1',
      DO_NOT_TRACK: '1', // cross-vendor signal; also independently disables the survey
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
    },
    // Inherited endpoints/headers are deleted, not overridden — an exporter that is turned back on
    // later must not find a collector address still sitting in the env.
    strip: [
      'BETA_TRACING_ENDPOINT',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'OTEL_EXPORTER_OTLP_HEADERS',
      'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
      'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      'CLAUDE_CODE_PROPAGATE_TRACEPARENT',
    ],
  },
  { key: 'privacyErrorReports', umbrella: true, env: { DISABLE_ERROR_REPORTING: '1' } },
  // /feedback · /bug · /share upload the whole transcript, code included.
  { key: 'privacyFeedbackCommands', env: { DISABLE_FEEDBACK_COMMAND: '1', DISABLE_BUG_COMMAND: '1' } },
  {
    key: 'privacyFeedbackSurvey', umbrella: true,
    env: { CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1' },
    strip: ['CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL'],
  },
  { key: 'privacyNonEssentialModelCalls', env: { DISABLE_NON_ESSENTIAL_MODEL_CALLS: '1' } },
  { key: 'privacyAutoUpdater', umbrella: true, env: { DISABLE_AUTOUPDATER: '1', DISABLE_DOCTOR_COMMAND: '1' } },
  // WebFetch otherwise sends the hostname it is about to fetch to api.anthropic.com for a blocklist
  // check. This is the one knob that is a *setting*, not an env var — and the one thing the umbrella
  // switch does not cover.
  { key: 'privacyWebFetchPreflight', env: {}, settings: { skipWebFetchPreflight: true } },
  { key: 'privacyArtifact', env: { CLAUDE_CODE_DISABLE_ARTIFACT: '1' } },
  { key: 'privacyMarketplace', env: { CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1' } },
];

export interface PrivacyPlan {
  active: boolean;                      // false = nothing blocked, leave the inherited env untouched
  env: Record<string, string>;
  strip: string[];
  settings: Record<string, unknown>;
}

// Resolve the master + per-channel switches into one plan. `on` is the config reader (cfg.bool);
// kept as a parameter so this module stays DB-free and testable.
export function privacyPlan(on: (key: string) => boolean): PrivacyPlan {
  const plan: PrivacyPlan = { active: false, env: {}, strip: [], settings: {} };
  const master = on(PRIVACY_MASTER);
  const blocked = (key: string) => master || on(key); // master overrides every channel key
  let allUmbrella = true;
  for (const c of PRIVACY_CHANNELS) {
    if (!blocked(c.key)) { if (c.umbrella) allUmbrella = false; continue; }
    plan.active = true;
    Object.assign(plan.env, c.env);
    if (c.strip) plan.strip.push(...c.strip);
    if (c.settings) Object.assign(plan.settings, c.settings);
  }
  // CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC blocks telemetry + error reports + the survey + the
  // updater wholesale, so it may only be set when every channel it covers is switched on. Otherwise
  // it would silently override an operator who deliberately let one of them back through.
  if (allUmbrella) plan.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return plan;
}

// Mutate a child-process env in place: strip the leak-back vars, then pin the opt-outs.
export function applyPrivacyEnv(env: Record<string, string | undefined>, plan: PrivacyPlan): void {
  if (!plan.active) return;
  for (const k of plan.strip) delete env[k];
  Object.assign(env, plan.env);
}

// `KEY=value` form for `docker createContainer({ Env })`.
export function privacyEnvList(plan: PrivacyPlan): string[] {
  return Object.entries(plan.env).map(([k, v]) => `${k}=${v}`);
}

// ── self-check (run once: PRIVACY_SELFCHECK=1 npx tsx server/src/claude/privacy.ts) ──
if (process.env.PRIVACY_SELFCHECK) {
  const assert = (cond: boolean, m: string) => { if (!cond) throw new Error('privacy check failed: ' + m); };
  const hostile = () => ({
    HOME: '/data/users/u1',
    DISABLE_TELEMETRY: '0',                             // hostile host value must be overridden
    BETA_TRACING_ENDPOINT: 'https://collector.example', // inherited endpoint must be removed
    OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer x',
  } as Record<string, string | undefined>);
  const allOn = () => true;
  const off = (...keys: string[]) => (k: string) => !keys.includes(k);

  // everything on
  const env = hostile();
  const full = privacyPlan(allOn);
  applyPrivacyEnv(env, full);
  // master alone must block every channel even with all the per-channel keys off
  const masterOnly = privacyPlan((k) => k === PRIVACY_MASTER);
  assert(JSON.stringify(masterOnly.env) === JSON.stringify(full.env), 'master alone blocks every channel');
  assert(masterOnly.settings.skipWebFetchPreflight === true, 'master alone covers the preflight setting too');
  assert(env.DISABLE_TELEMETRY === '1', 'host DISABLE_TELEMETRY=0 overridden to 1');
  assert(!('BETA_TRACING_ENDPOINT' in env), 'inherited tracing endpoint stripped');
  assert(!('OTEL_EXPORTER_OTLP_HEADERS' in env), 'inherited OTLP headers stripped');
  assert(env.HOME === '/data/users/u1', 'unrelated env untouched');
  assert(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1', 'umbrella set when every covered channel is on');
  assert(full.settings.skipWebFetchPreflight === true, 'WebFetch preflight skipped');
  assert(privacyEnvList(full).includes('DO_NOT_TRACK=1'), 'docker Env list carries the same vars');

  // nothing on at all → inherited env survives untouched
  const envOff = hostile();
  const none = privacyPlan(() => false);
  assert(!none.active, 'no switch on → inactive plan');
  applyPrivacyEnv(envOff, none);
  assert(envOff.DISABLE_TELEMETRY === '0' && envOff.BETA_TRACING_ENDPOINT === 'https://collector.example',
    'everything off leaves the inherited env alone');

  // master off + one covered channel off → its vars are gone AND the umbrella must not sneak it back off
  const envTel = hostile();
  const partial = privacyPlan(off(PRIVACY_MASTER, 'privacyTelemetry'));
  applyPrivacyEnv(envTel, partial);
  assert(!('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' in partial.env), 'umbrella withheld when a covered channel is off');
  assert(envTel.DISABLE_TELEMETRY === '0', 'telemetry channel off → its vars are not pinned');
  assert(envTel.BETA_TRACING_ENDPOINT === 'https://collector.example', 'telemetry channel off → its strip list is skipped');
  assert(envTel.DISABLE_ERROR_REPORTING === '1', 'other channels still applied');

  // a non-umbrella channel off must NOT withhold the umbrella var
  assert(privacyPlan(off(PRIVACY_MASTER, 'privacyArtifact')).env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1',
    'non-umbrella channel off still allows the umbrella var');
  assert(privacyPlan(off(PRIVACY_MASTER, 'privacyWebFetchPreflight')).settings.skipWebFetchPreflight === undefined,
    'preflight channel off → setting not sent');
  // ...but with the master back on, an "off" channel key is overridden, not honoured
  assert(privacyPlan(off('privacyWebFetchPreflight')).settings.skipWebFetchPreflight === true,
    'master on overrides an off channel key');
  // eslint-disable-next-line no-console
  console.log('privacy.ts self-check ok');
}
