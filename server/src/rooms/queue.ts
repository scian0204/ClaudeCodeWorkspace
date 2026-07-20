import { newId } from '../lib/ids.js';
import { runTurn } from '../claude/session-manager.js';

type Emit = (event: string, payload: any) => void;

export interface QueueItem { id: string; author: { id: string; name: string }; text: string; }

class SessionQueue {
  items: QueueItem[] = [];
  running: QueueItem | null = null;
  private busy = false;
  constructor(public sessionId: string, private emit: Emit) {}

  enqueue(item: QueueItem) {
    this.items.push(item);
    this.broadcast();
    void this.pump();
  }

  cancel(itemId: string): boolean {
    const i = this.items.findIndex((x) => x.id === itemId);
    if (i < 0) return false; // already running or gone -> cannot cancel via queue (needs interrupt)
    this.items.splice(i, 1);
    this.broadcast();
    return true;
  }

  state() {
    return {
      sessionId: this.sessionId,
      running: this.running ? { id: this.running.id, author: this.running.author } : null,
      waiting: this.items.map((x) => ({ id: x.id, author: x.author })),
    };
  }
  private broadcast() { this.emit('queue:update', this.state()); }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.items.length) {
        const item = this.items.shift()!;
        this.running = item;
        this.broadcast();
        try {
          await runTurn({ chatSessionId: this.sessionId, author: item.author, text: item.text, emit: this.emit });
        } catch (e) {
          this.emit('turn:error', { sessionId: this.sessionId, error: String((e as any)?.message || e) });
        }
        this.running = null;
        this.broadcast();
      }
    } finally {
      this.busy = false;
    }
  }
}

let emitFactory: (sessionId: string) => Emit = () => () => {};
export function setEmitFactory(f: (sessionId: string) => Emit) { emitFactory = f; }

const queues = new Map<string, SessionQueue>();
function getQueue(sessionId: string): SessionQueue {
  let q = queues.get(sessionId);
  if (!q) { q = new SessionQueue(sessionId, emitFactory(sessionId)); queues.set(sessionId, q); }
  return q;
}

export function enqueueTurn(sessionId: string, author: { id: string; name: string }, text: string): string {
  const id = newId();
  getQueue(sessionId).enqueue({ id, author, text });
  return id;
}
export function cancelQueued(sessionId: string, itemId: string): boolean {
  return getQueue(sessionId).cancel(itemId);
}
export function queueState(sessionId: string) { return getQueue(sessionId).state(); }
