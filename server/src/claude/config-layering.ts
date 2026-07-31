import path from 'node:path';
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { cfg } from '../lib/config-registry.js';
import { paths, allowedRootsFor, isInsideRoots } from '../lib/paths.js';
import { PROVIDER_ENV_KEYS } from '../auth/provider.js';
import { applyPrivacyEnv, privacyPlan } from './privacy.js';

export type PermMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface SessionContext {
  kind: 'user' | 'room';
  ownerId: string;   // uid or roomId -> whose HOME
  cwd: string;       // project dir the turn runs in
  model: string;
  effort?: EffortLevel; // SDK reasoning effort; unsupported models silently downgrade
  permissionMode: PermMode;
  plugins: string[]; // resolved enabled plugin dir paths (common class-2 + forced + personal)
  authToken: string; // resolved Claude token for the turn's author ('' => mock/no-auth)
  providerEnv?: Record<string, string>; // LLM provider override env (bedrock/vertex/custom-base-URL); applied over authToken
  providerModel?: string;               // provider model id/ARN override (wins over ctx.model)
  gitEnv?: Record<string, string>; // git author identity + askpass creds so Claude can commit/push
  mcpServers?: Record<string, any>; // review sandbox exposes its `run` tool here
  disallowedTools?: string[];       // review turns deny host 'Bash' → exec only via the sandbox tool
}

export function homeFor(ctx: SessionContext): string {
  return ctx.kind === 'user' ? paths.userHome(ctx.ownerId) : paths.roomHome(ctx.ownerId);
}

// Clamp a requested mode to the admin ceiling (class-1 policy).
export function clampMode(requested: PermMode, allowBypass: boolean): PermMode {
  if (!allowBypass && requested === 'bypassPermissions') return 'acceptEdits';
  return requested;
}

export function rootsFor(ctx: SessionContext): string[] {
  return allowedRootsFor(ctx.kind, ctx.ownerId, ctx.cwd);
}

// Build the per-call Agent SDK Options. Everything here is per-session.
export function buildOptions(ctx: SessionContext, extra: {
  canUseTool: any;
  resume?: string | null;
  abortController: AbortController;
}) {
  const home = homeFor(ctx);
  const roots = rootsFor(ctx);
  const additionalDirectories = roots.filter((r) => r !== path.resolve(ctx.cwd));

  const env: Record<string, string> = { ...process.env } as any;
  env.HOME = home;
  // OAuth tokens (sk-ant-oat*, from `claude setup-token` / Pro-Max login) must go via
  // CLAUDE_CODE_OAUTH_TOKEN; plain API keys (sk-ant-api*) via ANTHROPIC_API_KEY.
  // Passing an OAuth token as ANTHROPIC_API_KEY is rejected by the API (401 Invalid API key).
  // Clear EVERY provider-controlled var (tokens + bedrock/vertex/base-URL/AWS) so a stray host-global
  // var can never leak into a default-token or mock turn; the resolved provider env is the sole source.
  for (const k of PROVIDER_ENV_KEYS) delete env[k];
  const key = ctx.authToken;
  if (key) {
    if (key.startsWith('sk-ant-oat')) env.CLAUDE_CODE_OAUTH_TOKEN = key;
    else env.ANTHROPIC_API_KEY = key;
  }
  // LLM provider override: applied AFTER the default token path so the provider fully controls auth
  // (bedrock/vertex/custom base URL). When no provider is configured this is undefined and the token
  // path above is unchanged — the default Anthropic-token behavior does not regress.
  if (ctx.providerEnv) Object.assign(env, ctx.providerEnv);
  // Git identity + credentials so the agent's own `git commit`/`git push` are attributed and authenticated.
  if (ctx.gitEnv) Object.assign(env, ctx.gitEnv);
  // Non-essential Anthropic egress (telemetry / error reports / feedback+transcript upload / surveys /
  // updater pings / WebFetch preflight). Applied LAST so nothing above can reopen a channel; when the
  // admin toggle is off we leave the inherited env alone so a deliberate OTel setup still works.
  const privacy = privacyPlan((k) => cfg.bool(k));
  applyPrivacyEnv(env, privacy);

  const options: any = {
    cwd: ctx.cwd,
    env,
    model: ctx.providerModel || ctx.model, // provider model id/ARN overrides the dropdown model
    permissionMode: ctx.permissionMode,
    effort: ctx.effort,
    settingSources: ['user', 'project', 'local'],
    additionalDirectories,
    plugins: ctx.plugins.length ? ctx.plugins.map((p) => ({ type: 'local' as const, path: p })) : undefined,
    canUseTool: extra.canUseTool,
    abortController: extra.abortController,
    includePartialMessages: true,
  };
  // skipWebFetchPreflight is a *setting*, not an env var — the SDK's flag-settings layer beats the
  // user's own ~/.claude/settings.json without us writing to it.
  if (Object.keys(privacy.settings).length) options.settings = privacy.settings;
  if (extra.resume) options.resume = extra.resume;
  if (ctx.mcpServers) options.mcpServers = ctx.mcpServers;
  if (ctx.disallowedTools?.length) options.disallowedTools = ctx.disallowedTools;
  const ccPath = cfg.str('claudeCodePath');
  if (ccPath) options.pathToClaudeCodeExecutable = ccPath;
  return options;
}

// Class-1 soft fence: path-bearing tools must stay inside allowed roots.
// Best-effort (trusted-team posture): covers file tools; Bash stays a soft boundary.
const PATH_TOOLS = new Set(['Edit', 'Write', 'Read', 'NotebookEdit', 'MultiEdit']);
export function fenceViolation(toolName: string, input: any, roots: string[]): string | null {
  if (!PATH_TOOLS.has(toolName)) return null;
  const p = input?.file_path || input?.path || input?.notebook_path;
  if (!p) return null;
  return isInsideRoots(p, roots) ? null : `Path '${p}' is outside your workspace (blocked by isolation policy).`;
}
