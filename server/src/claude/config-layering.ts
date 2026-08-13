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
  agents?: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }>; // team agents (SDK options.agents)
  agentName?: string;               // main-thread agent (SDK options.agent) — must be a key of `agents`
  unattended?: boolean;             // review pipeline: auto-allow canUseTool, never prompts a human
}

export function homeFor(ctx: SessionContext): string {
  return ctx.kind === 'user' ? paths.userHome(ctx.ownerId) : paths.roomHome(ctx.ownerId);
}

// Clamp a requested mode to the admin ceiling (class-1 policy).
export function clampMode(requested: PermMode, allowBypass: boolean): PermMode {
  if (!allowBypass && requested === 'bypassPermissions') return 'acceptEdits';
  return requested;
}

const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

// bypassPermissions maps to the CLI's --dangerously-skip-permissions, which the CLI refuses when the
// process is root ("cannot be used with root/sudo privileges") → the subprocess exits 1 and the whole
// turn fails. This container runs as root (Docker socket + /data), so hand the SDK acceptEdits
// instead; makeCanUseTool auto-allows every tool in bypass mode, so the mode's behavior is unchanged.
export function sdkMode(mode: PermMode, asRoot = RUNNING_AS_ROOT): PermMode {
  return mode === 'bypassPermissions' && asRoot ? 'acceptEdits' : mode;
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
  // Upstream SDK bug (anthropics/claude-code#27203): a BACKGROUND subagent's tool call that needs
  // permission never reaches canUseTool — the CLI denies it internally, and that denial corrupts
  // the control stream so every later permission round-trip in the turn fails with
  // "Tool permission request failed: AbortError: Stream closed" (main thread included; observed
  // live on 2.1.229). Foreground subagents pass prompts through canUseTool normally, so whenever
  // this session can actually prompt a human, keep subagents in the foreground with the official
  // kill switch. bypass mode and unattended (review) turns never prompt — they keep background
  // tasks. `bgTasksWithPrompts` re-enables them everywhere once the upstream fix lands.
  if (ctx.permissionMode !== 'bypassPermissions' && !ctx.unattended && !cfg.bool('bgTasksWithPrompts')) {
    env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1';
  }
  // Agent Teams (experimental upstream): turns on the CLI's team plumbing — named teammates,
  // shared task list, inter-agent mail (SendMessage). In SDK/headless mode teammates surface as
  // named background agents on the same stream (parent_tool_use_id + task_* events), so the task
  // panel's live/split view is their UI. NOTE: teammates ARE background tasks — in prompting modes
  // the #27203 workaround above forces them foreground, so real concurrent teams currently need a
  // bypass-mode session (or bgTasksWithPrompts on).
  if (cfg.bool('agentTeamsEnabled')) env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1';

  const options: any = {
    cwd: ctx.cwd,
    env,
    model: ctx.providerModel || ctx.model, // provider model id/ARN overrides the dropdown model
    permissionMode: sdkMode(ctx.permissionMode),
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
  // team agents: subagent definitions + (guarded) the main-thread persona. The guard is load-bearing:
  // options.agent naming an agent absent from the map makes the CLI error the whole turn, and an
  // agent deleted after being selected on a session must degrade to default instead.
  if (ctx.agents && Object.keys(ctx.agents).length) {
    options.agents = ctx.agents;
    if (ctx.agentName && ctx.agents[ctx.agentName]) options.agent = ctx.agentName;
  }
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
