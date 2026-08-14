// Runnable check: npx vitest run server/src/claude/usage-limits.test.ts
import { describe, it, expect } from 'vitest';
import { limitsSettled } from './usage-limits.js';

// The shape that kept the usage popover empty: a CLI that started a moment ago answers with the
// scope verdict already filled in but the account figures still missing. Observed live against a
// team subscription — `rate_limits_available: true`, `subscription_type: 'team'`, `rate_limits: null`
// — and the next ask, a second later, carried the real windows.
const notReady = { subscription_type: 'team', rate_limits_available: true, rate_limits: null };
const ready = {
  subscription_type: 'team',
  rate_limits_available: true,
  rate_limits: { five_hour: { utilization: 5, resets_at: '2026-08-14T09:20:00+00:00' }, seven_day: null, model_scoped: [] },
};
const noPlan = { subscription_type: null, rate_limits_available: false, rate_limits: null };

describe('limitsSettled', () => {
  it('rejects a lookup that has not come back yet', () => {
    expect(limitsSettled(notReady)).toBe(false);
    expect(limitsSettled(null)).toBe(false);
    expect(limitsSettled(undefined)).toBe(false);
  });

  it('accepts real windows, and accepts a real "this credential has none"', () => {
    expect(limitsSettled(ready)).toBe(true);
    expect(limitsSettled(noPlan)).toBe(true); // API key / inference-only token — never has windows
  });
});
