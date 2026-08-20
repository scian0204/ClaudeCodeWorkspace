import { newId } from '../lib/ids.js';
import { fenceViolation, type PermMode } from './config-layering.js';

export type Decision = 'allow' | 'deny' | 'always';
// A prompt resolves either to a permission decision, or (for option-based tools like
// AskUserQuestion) to a free-form answer that gets fed back to Claude.
type Resolution = { decision: Decision } | { answer: string };

interface Pending {
  sessionId: string;
  tool: string;
  input: any;
  resolve: (r: Resolution) => void;
}
const pending = new Map<string, Pending>();

// per chat-session "always allow" memory (tool names)
const alwaysAllowed = new Map<string, Set<string>>();
export function getAlwaysAllowed(sessionId: string): Set<string> {
  let s = alwaysAllowed.get(sessionId);
  if (!s) { s = new Set(); alwaysAllowed.set(sessionId, s); }
  return s;
}

export function pendingForSession(sessionId: string) {
  return [...pending.entries()]
    .filter(([, p]) => p.sessionId === sessionId)
    .map(([requestId, p]) => ({ requestId, tool: p.tool, input: p.input }));
}

// Called by the realtime layer AFTER it has authorized the responder
// (room owner / delegated member, or the private-session owner).
export function respondPermission(requestId: string, decision: Decision, answer?: string): boolean {
  const p = pending.get(requestId);
  if (!p) return false;
  pending.delete(requestId);
  if (answer != null) p.resolve({ answer });
  else p.resolve({ decision });
  return true;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// AskUserQuestion is not a permission — it IS the channel that asks the human. Letting any
// auto-allow path through (bypass mode, a stale "always allow") hands the call back to the CLI,
// which runs the tool with nobody attached: it answers itself with "The user did not answer the
// questions." and the turn walks on past the choice. These tools always prompt, whatever the mode.
const ALWAYS_PROMPT = new Set(['AskUserQuestion']);
function autoAllows(mode: PermMode, tool: string): boolean {
  // bypass: the SDK normally never calls canUseTool, but under root it gets acceptEdits instead
  // (see sdkMode) and then DOES ask us about non-edit tools — allow everything to keep bypass's
  // "never prompt" semantics. The class-1 fence above still applies.
  if (mode === 'bypassPermissions') return true;
  if (mode === 'acceptEdits') return EDIT_TOOLS.has(tool);
  return false; // default/plan -> prompt
}

// Unattended auto-allow: used by review sessions so the automatic pipeline (build/run/tests) never
// blocks on a human prompt. The class-1 fence still applies — path tools outside the worktree roots
// are denied. Bash stays a soft boundary (same posture as bypass mode). No permission events emitted.
// ponytail: SECURITY CEILING — this runs the PR's own build/test code unattended, so a hostile PR
// can execute arbitrary Bash in the app container and read the turn's Claude token from its env (the
// merge-capable git PAT is already withheld from review turns; see session-manager buildGitEnv skip).
// Fine for a trusted team reviewing its own PRs. For repos that take untrusted external PRs, set
// REVIEW_AUTO=0 (manual trigger). Upgrade path: run the build in a network/socket-less sandbox
// container instead of the backend process.
export function makeAutoAllow(roots: string[]) {
  return async (toolName: string, input: any) => {
    const v = fenceViolation(toolName, input, roots);
    if (v) return { behavior: 'deny', message: v } as const;
    return { behavior: 'allow', updatedInput: input } as const;
  };
}

export function makeCanUseTool(opts: {
  sessionId: string;
  roots: string[];
  mode: PermMode;
  emit: (event: string, payload: any) => void;
  signal: AbortSignal;
}) {
  const always = getAlwaysAllowed(opts.sessionId);
  return async (toolName: string, input: any, ctx: { signal?: AbortSignal }) => {
    // class-1 fence — always applied, mode-independent
    const v = fenceViolation(toolName, input, opts.roots);
    if (v) return { behavior: 'deny', message: v } as const;

    if (!ALWAYS_PROMPT.has(toolName)) {
      if (always.has(toolName)) return { behavior: 'allow', updatedInput: input } as const;
      if (autoAllows(opts.mode, toolName)) return { behavior: 'allow', updatedInput: input } as const;
    }

    const requestId = newId();
    const r = await new Promise<Resolution>((resolve) => {
      pending.set(requestId, { sessionId: opts.sessionId, tool: toolName, input, resolve });
      opts.emit('permission:request', { requestId, sessionId: opts.sessionId, tool: toolName, input });
      const onAbort = () => {
        if (pending.has(requestId)) { pending.delete(requestId); resolve({ decision: 'deny' }); }
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
    });

    // Option pick (AskUserQuestion): canUseTool has no "answer" channel, so feed the
    // selection back as the tool result via a deny message — Claude reads it and continues.
    if ('answer' in r) {
      opts.emit('permission:resolved', { requestId, sessionId: opts.sessionId, decision: 'answer' });
      return { behavior: 'deny', message: r.answer } as const;
    }

    const decision = r.decision;
    opts.emit('permission:resolved', { requestId, sessionId: opts.sessionId, decision });
    if (decision === 'deny') return { behavior: 'deny', message: 'Denied.' } as const;
    if (decision === 'always') always.add(toolName);
    return { behavior: 'allow', updatedInput: input } as const;
  };
}
