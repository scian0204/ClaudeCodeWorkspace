// Mock socket.io Socket for the static demo. Store wiring is unchanged — the store still
// calls .on()/.emit(); here .emit() interprets outbound events and synthesizes the inbound
// stream (message → turn:start → deltas → tool → turn:end), including one permission prompt
// on the first turn of each chat so the web-approval UX is demoable.
import { db } from './data';

type Fn = (...a: any[]) => void;
const rid = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);

const handlers = new Map<string, Fn[]>();
const timers: any[] = [];
const gated = new Set<string>();
const waiting = new Map<string, () => void>(); // requestId → continue-the-turn

function deliver(event: string, payload?: any) { (handlers.get(event) || []).forEach((fn) => fn(payload)); }
function later(ms: number, fn: Fn) { timers.push(setTimeout(fn, ms)); }
function clearTimers() { timers.splice(0).forEach(clearTimeout); }

const chunks = (s: string, n = 3) => {
  const words = s.split(' '); const out: string[] = []; const step = Math.ceil(words.length / n);
  for (let i = 0; i < words.length; i += step) out.push(words.slice(i, i + step).join(' ') + (i + step < words.length ? ' ' : ''));
  return out;
};

function reply(text: string) {
  const short = text.length > 56 ? text.slice(0, 53) + '…' : text;
  const isCmd = text.trim().startsWith('/');
  return {
    intro: isCmd ? `Running \`${text.trim()}\`. Let me pull the current state first.` : `Sure — let me take a look at "${short}".`,
    tool: { name: 'Bash', input: { command: 'grep -rn "TODO" src/ | head' }, output: 'src/index.ts:42:  // TODO: wire up metrics\nsrc/db.ts:88:  // TODO: add retry' },
    outro: 'Found a couple of spots. Here is what I would change:\n\n```ts\n// wrap the flaky call in a small retry\nawait withRetry(() => db.query(sql), { tries: 3 });\n```\n\nWant me to apply it and run the tests?',
  };
}

function appendMsg(sessionId: string, msg: any) { (db.messages[sessionId] || (db.messages[sessionId] = [])).push(msg); }

function runTurn(sessionId: string, text: string) {
  const r = reply(text);
  const finalBlocks: any[] = [];

  const streamOutro = () => {
    let d = 200;
    chunks(r.outro).forEach((c) => later(d += 180, () => deliver('assistant:delta', { sessionId, text: c })));
    finalBlocks.push({ type: 'text', text: r.outro });
    later(d += 300, () => {
      const msg = { id: `m_${rid()}`, role: 'assistant', authorId: null, authorName: 'Claude', content: { blocks: finalBlocks }, createdAt: Date.now() };
      appendMsg(sessionId, msg);
      deliver('turn:end', { sessionId, message: msg });
    });
  };

  const runTool = () => {
    const id = `t_${rid()}`;
    deliver('tool:use', { sessionId, id, name: r.tool.name, input: r.tool.input });
    finalBlocks.push({ type: 'tool_use', id, name: r.tool.name, input: r.tool.input });
    later(700, () => {
      deliver('tool:result', { sessionId, id, output: r.tool.output, isError: false });
      finalBlocks[finalBlocks.length - 1].output = r.tool.output;
      streamOutro();
    });
  };

  // intro text
  let d = 150;
  chunks(r.intro).forEach((c) => later(d += 160, () => deliver('assistant:delta', { sessionId, text: c })));
  finalBlocks.push({ type: 'text', text: r.intro });

  if (!gated.has(sessionId)) {
    // first turn in this chat → ask for permission before the tool runs
    gated.add(sessionId);
    later(d += 400, () => {
      const requestId = `perm_${rid()}`;
      waiting.set(requestId, runTool);
      deliver('permission:request', { sessionId, requestId, tool: r.tool.name, input: r.tool.input });
    });
  } else {
    later(d += 400, runTool);
  }
}

const sock = {
  connected: true,
  id: `demo_${rid()}`,
  on(event: string, cb: Fn) { (handlers.get(event) || handlers.set(event, []).get(event)!).push(cb); return sock; },
  off(event: string) { handlers.delete(event); return sock; },
  emit(event: string, ...args: any[]) {
    if (event === 'session:join') {
      const [sessionId, ack] = args;
      if (typeof ack === 'function') ack({ queue: { running: null, waiting: [] }, pending: [], control: { canApprove: true, canInterrupt: true, canSetMode: true, isOwner: true, delegable: [] } });
      const room = db.rooms.find((r) => r.chatSessionId === sessionId);
      if (room) later(60, () => deliver('presence:update', { sessionId, users: room.members.map((m: any) => ({ id: m.userId, name: m.displayName, color: m.avatarColor })) }));
      return sock;
    }
    if (event === 'chat:send') {
      const { sessionId, text } = args[0] || {};
      appendMsg(sessionId, { id: `m_${rid()}`, role: 'user', authorId: db.me.id, authorName: db.me.displayName, content: { text }, createdAt: Date.now() });
      deliver('message', { sessionId, message: db.messages[sessionId][db.messages[sessionId].length - 1] });
      deliver('turn:start', { sessionId });
      runTurn(sessionId, text);
      return sock;
    }
    if (event === 'permission:respond') {
      const { requestId, decision, sessionId } = args[0] || {};
      const cont = waiting.get(requestId); waiting.delete(requestId);
      if (decision === 'deny') {
        const msg = { id: `m_${rid()}`, role: 'assistant', authorId: null, authorName: 'Claude', content: { blocks: [{ type: 'text', text: "Understood — I won't run that. Let me know how you'd like to proceed." }] }, createdAt: Date.now() };
        appendMsg(sessionId, msg);
        later(150, () => deliver('turn:end', { sessionId, message: msg }));
      } else if (cont) later(150, cont);
      return sock;
    }
    if (event === 'chat:interrupt' || event === 'chat:cancel') {
      clearTimers(); waiting.clear();
      const sessionId = args[0]?.sessionId;
      deliver('turn:error', { sessionId, aborted: true });
      return sock;
    }
    return sock; // session:leave and anything else → no-op
  },
};

export function getDemoSocket() { return sock as any; }
