import path from 'node:path';
import { config } from '../config.js';
import { paths, allowedRootsFor, isInsideRoots } from '../lib/paths.js';

export type PermMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface SessionContext {
  kind: 'user' | 'room';
  ownerId: string;   // uid or roomId -> whose HOME
  cwd: string;       // project dir the turn runs in
  model: string;
  permissionMode: PermMode;
  plugins: string[]; // resolved enabled plugin dir paths (common class-2 + forced + personal)
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
  const key = config.anthropicApiKey;
  if (key) {
    if (key.startsWith('sk-ant-oat')) { env.CLAUDE_CODE_OAUTH_TOKEN = key; delete env.ANTHROPIC_API_KEY; }
    else env.ANTHROPIC_API_KEY = key;
  }

  const options: any = {
    cwd: ctx.cwd,
    env,
    model: ctx.model,
    permissionMode: ctx.permissionMode,
    settingSources: ['user', 'project', 'local'],
    additionalDirectories,
    plugins: ctx.plugins.length ? ctx.plugins.map((p) => ({ type: 'local' as const, path: p })) : undefined,
    canUseTool: extra.canUseTool,
    abortController: extra.abortController,
    includePartialMessages: true,
  };
  if (extra.resume) options.resume = extra.resume;
  if (config.claudeCodePath) options.pathToClaudeCodeExecutable = config.claudeCodePath;
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
