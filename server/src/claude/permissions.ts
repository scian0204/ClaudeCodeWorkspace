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
function autoAllows(mode: PermMode, tool: string): boolean {
  if (mode === 'acceptEdits') return EDIT_TOOLS.has(tool);
  return false; // default/plan -> prompt; bypass -> SDK never calls canUseTool
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

    if (always.has(toolName)) return { behavior: 'allow', updatedInput: input } as const;
    if (autoAllows(opts.mode, toolName)) return { behavior: 'allow', updatedInput: input } as const;

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
