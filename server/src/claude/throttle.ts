import { config } from '../config.js';

// Global concurrent-turn cap across ALL sessions (shared-key server throttle).
// Separate from the per-room FIFO queue.
export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(public max: number) {}
  get waiting() { return this.waiters.length; }
  get inUse() { return this.active; }

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const w = this.waiters.shift();
      if (w) w();
    };
  }
}

export const turnLimiter = new Semaphore(config.maxConcurrentTurns);

// 429 / overloaded backoff around a unit of work.
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  onBackoff?: (ms: number, attempt: number) => void,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      const is429 = e?.status === 429 || /\b429\b|rate.?limit|overloaded/i.test(msg);
      if (!is429 || attempt >= 5) throw e;
      const ms = Math.min(30_000, 1000 * 2 ** attempt);
      onBackoff?.(ms, attempt);
      await new Promise((r) => setTimeout(r, ms));
      attempt++;
    }
  }
}
