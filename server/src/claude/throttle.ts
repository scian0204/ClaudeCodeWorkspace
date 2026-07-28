import { cfg, registerApply } from '../lib/config-registry.js';

// Global concurrent-turn cap across ALL sessions (shared-key server throttle).
// Separate from the per-room FIFO queue. `max` is read live from config so an admin can change the
// cap without a restart.
export class Semaphore {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private getMax: () => number) {}
  get max() { return this.getMax(); }
  get waiting() { return this.waiters.length; }
  get inUse() { return this.active; }

  async acquire(): Promise<() => void> {
    // loop, not a single if: a woken waiter re-checks capacity (the cap may have shrunk since, or
    // another waiter may have taken the slot first) and re-queues itself if still full.
    while (this.active >= this.max) {
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

  // Admin raised the cap → wake up to (max - active) waiters so freed capacity is used immediately.
  // Woken waiters resume sequentially on the microtask queue, each incrementing `active` before the
  // next runs, and the acquire() loop re-guards, so this can't overshoot `max`.
  refresh() {
    let slots = this.max - this.active;
    while (slots-- > 0) {
      const w = this.waiters.shift();
      if (!w) break;
      w();
    }
  }
}

export const turnLimiter = new Semaphore(() => cfg.int('maxConcurrentTurns'));
registerApply('maxConcurrentTurns', () => turnLimiter.refresh());

// 429 / overloaded backoff around a unit of work.
export async function withRateLimitRetry<T>(
  fn: () => Promise<T>,
  onBackoff?: (ms: number, attempt: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw new Error('interrupted');
    try {
      return await fn();
    } catch (e: any) {
      if (signal?.aborted) throw e;
      const msg = String(e?.message || e || '');
      const is429 = e?.status === 429 || /\b429\b|rate.?limit|overloaded/i.test(msg);
      if (!is429 || attempt >= cfg.int('turnMaxRetries')) throw e;
      const ms = Math.min(cfg.int('turnBackoffCapMs'), cfg.int('turnBackoffBaseMs') * 2 ** attempt);
      onBackoff?.(ms, attempt);
      // abort must cut the backoff short — otherwise "stop" waits out up to the cap of sleep
      await new Promise<void>((resolve) => {
        const to = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(to); resolve(); }, { once: true });
      });
      if (signal?.aborted) throw new Error('interrupted');
      attempt++;
    }
  }
}
