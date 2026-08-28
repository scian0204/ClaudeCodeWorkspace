// Side chat — the workspace's answer to the CLI's `/btw`.
//
// "Ask a quick side question without interrupting the main conversation." In the terminal that opens
// a panel; here it is a floating window over the chat. The point is that the question and its answer
// see the whole conversation but never join it: the main transcript must read exactly the same
// afterwards, so the next real turn is not carrying the detour around in its context.
//
// How the context comes across without being polluted: the CLI can FORK a session (`forkSession`
// with `resume`), which loads the transcript and then writes to a NEW session id. The main session
// keeps its own id and its own file. The forked id is remembered per (chat, person) so follow-up
// questions continue the same side thread; "start over" forgets it and the next question forks the
// main conversation again — by then it has moved on, which is what you want.
//
// It is read-only on purpose. The panel has no permission prompt, and a side question is a question:
// the agent may look at files, it may not change them, and canUseTool refuses everything else
// outright rather than asking through a dialog that is not there.
//
// Nothing is persisted. The side chat lives in the browser tab that asked; closing the workspace
// throws it away, which is what "does not join the conversation" should mean.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { paths, ensure } from '../lib/paths.js';
import { allowBypass } from '../lib/settings.js';
import { cfg } from '../lib/config-registry.js';
import { resolveProvider } from '../auth/provider.js';
import { resolvePluginPaths } from '../plugins/manager.js';
import { buildOptions, clampMode, type SessionContext } from './config-layering.js';
import { cwdFor, type Block, type Emit } from './session-manager.js';

// Look but don't touch. Everything that writes, runs a command, or spends a subagent is out.
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'TodoWrite'];
const DENIED_TOOLS = [
  'Bash', 'BashOutput', 'KillShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
  'Task', 'SlashCommand', 'ExitPlanMode', 'WebFetch', 'WebSearch',
];

const SYSTEM_APPEND = `
You are answering in a SIDE CHAT opened next to the conversation above. The person wants a quick
answer about that work without derailing it. Nothing you say here goes back into the main
conversation, and the main conversation will continue as if this exchange never happened.

Answer briefly and directly, in the language the question is asked in. You may read files to check
something, but you must not change anything — editing, running commands and delegating to subagents
are all switched off here. If the question really needs work done, say so and let them ask in the
main conversation instead.
`.trim();

// key = chat session + person: two people in one room each get their own side thread.
const key = (chatSessionId: string, userId: string) => `${chatSessionId}:${userId}`;

interface Aside {
  forkedId: string | null;              // the CLI session this side thread writes to, once forked
  abort?: AbortController;              // set while a turn is running
  query?: { interrupt: () => Promise<unknown> };
}
const threads = new Map<string, Aside>();

const get = (k: string): Aside => {
  const hit = threads.get(k);
  if (hit) return hit;
  const fresh: Aside = { forkedId: null };
  threads.set(k, fresh);
  return fresh;
};

export function asideBusy(chatSessionId: string, userId: string): boolean {
  return !!threads.get(key(chatSessionId, userId))?.abort;
}

export function interruptAside(chatSessionId: string, userId: string): boolean {
  const a = threads.get(key(chatSessionId, userId));
  if (!a?.abort) return false;
  try { void a.query?.interrupt().catch(() => { /* abort below is the fallback */ }); } catch { /* noop */ }
  a.abort.abort();
  return true;
}

// "Start over": drop the fork so the next question branches off the main conversation as it stands
// now. A turn still running is stopped first, or its answer would land in a thread nobody is showing.
export function clearAside(chatSessionId: string, userId: string): void {
  interruptAside(chatSessionId, userId);
  threads.delete(key(chatSessionId, userId));
}

// A chat being deleted must not leave side threads pointing at a CLI session that no longer exists.
export function forgetAsides(chatSessionId: string): void {
  for (const k of [...threads.keys()]) if (k.startsWith(`${chatSessionId}:`)) threads.delete(k);
}

const MOCK_REPLY = 'No Claude credentials are configured for your account, so the side chat cannot answer.'
  + '\n\n계정에 Claude 자격증명이 없어 사이드 채팅이 답변할 수 없습니다.';

export interface RunAsideParams {
  chatSessionId: string;
  userId: string;
  text: string;
  emit: Emit;   // fans out to every tab of the asking user only — a side chat is not shared
}

export async function runAsideTurn(p: RunAsideParams): Promise<void> {
  const k = key(p.chatSessionId, p.userId);
  const a = get(k);
  if (a.abort) throw new Error('busy');

  const s = db.select().from(schema.chatSessions).where(eq(schema.chatSessions.id, p.chatSessionId)).get();
  if (!s) throw new Error('session not found');

  const abort = new AbortController();
  a.abort = abort;
  const blocks: Block[] = [];
  p.emit('aside:start', { sessionId: p.chatSessionId });

  try {
    // The asker's own credentials — never the session owner's. A side chat is that person asking.
    const prov = resolveProvider(p.userId);
    if (prov.source === 'none') {
      blocks.push({ type: 'text', text: MOCK_REPLY });
      p.emit('aside:delta', { sessionId: p.chatSessionId, text: MOCK_REPLY });
    } else {
      const kind: 'user' | 'room' = s.kind === 'room' ? 'room' : 'user';
      const ownerId = kind === 'room' ? s.roomId! : s.ownerId;
      ensure(paths.userHome(p.userId));
      const ctx: SessionContext = {
        kind, ownerId, cwd: await cwdFor(s),
        model: s.model || cfg.str('defaultModel'),
        effort: (s.effort || cfg.str('defaultEffort')) as SessionContext['effort'],
        // Plan mode is the closest match to "answer, do not act". The session's own mode is
        // deliberately ignored — the tool lists below are what actually hold the line.
        permissionMode: clampMode('plan', allowBypass()),
        plugins: resolvePluginPaths(kind, ownerId, s.projectId),
        authToken: '', providerEnv: prov.env, providerModel: prov.model,
        disallowedTools: DENIED_TOOLS,
        systemPromptAppend: SYSTEM_APPEND,
      };

      // First question forks the main conversation; the rest continue the fork. With no main
      // transcript yet (nothing asked in the chat) there is simply nothing to fork.
      const branchFrom = a.forkedId || s.claudeSessionId || null;
      const forking = !a.forkedId && !!s.claudeSessionId;

      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const options = buildOptions(ctx, {
        canUseTool: async (name: string) => (READ_ONLY_TOOLS.includes(name)
          ? { behavior: 'allow' as const, updatedInput: undefined }
          : { behavior: 'deny' as const, message: `${name} is not available in the side chat — ask in the main conversation.` }),
        resume: branchFrom,
        abortController: abort,
      });
      options.maxTurns = cfg.int('asideMaxTurns');
      // The load-bearing lines: with resume + forkSession the CLI reads the whole conversation and
      // then writes somewhere else, leaving the main transcript untouched. The id of that somewhere
      // else is named here rather than left to the CLI — the entire promise of this panel is that it
      // does not write into the chat, so where the writes land is not something to find out
      // afterwards from whatever id came back.
      if (forking) {
        options.forkSession = true;
        options.sessionId = randomUUID();
      }

      await stream({ query, options, prompt: p.text, blocks, thread: a, sessionId: p.chatSessionId, emit: p.emit, abort });
    }
    p.emit('aside:end', { sessionId: p.chatSessionId, blocks });
  } catch (e: any) {
    const aborted = abort.signal.aborted;
    if (blocks.length) p.emit('aside:end', { sessionId: p.chatSessionId, blocks, interrupted: aborted });
    p.emit('aside:error', { sessionId: p.chatSessionId, aborted, error: aborted ? 'interrupted' : String(e?.message || e) });
  } finally {
    a.abort = undefined;
    a.query = undefined;
  }
}

async function stream(x: {
  query: any; options: any; prompt: string; blocks: Block[]; thread: Aside;
  sessionId: string; emit: Emit; abort: AbortController;
}) {
  const once = async (opts: any) => {
    const q = x.query({ prompt: x.prompt, options: opts });
    x.thread.query = q as { interrupt: () => Promise<unknown> };
    let sid: string | null = null;
    for await (const msg of q as any) {
      if (x.abort.signal.aborted) break;
      if (msg?.session_id) sid = msg.session_id;
      if (msg?.type === 'stream_event') {
        const ev = msg.event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          x.emit('aside:delta', { sessionId: x.sessionId, text: ev.delta.text });
        }
      } else if (msg?.type === 'assistant') {
        for (const b of msg.message?.content || []) {
          if (b.type === 'text') x.blocks.push({ type: 'text', text: b.text });
        }
      }
    }
    if (x.abort.signal.aborted) throw new Error('interrupted');
    // Whatever id the CLI ended up writing to IS the side thread from now on. When the turn forked,
    // this is the new branch; when it continued one, it is the same id back again.
    if (sid) x.thread.forkedId = sid;
  };

  try {
    await once(x.options);
  } catch (e: any) {
    // The transcript we branched from is gone (pruned, or the chat was cleared). Ask again with no
    // history rather than failing the question outright.
    const recoverable = x.options.resume && !x.abort.signal.aborted
      && /No conversation found/i.test(String(e?.message || e));
    if (!recoverable) throw e;
    x.thread.forkedId = null;
    x.blocks.length = 0;
    const retry = { ...x.options };
    delete retry.resume;
    delete retry.forkSession;
    await once(retry);
  }
}
