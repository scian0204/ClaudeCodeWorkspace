// ── when the 5-hour window primer is allowed to open a window ──
// By default the primer is continuous: the moment no claude.ai window is running it opens one, all
// day, every day. That spends a message at 03:00 for hours nobody will use. This narrows it two
// ways, and they compose:
//   from/to — only prime while the local clock is inside this range (it may wrap midnight)
//   times   — prime only at these clock times (otherwise sleep until the next one)
// Both are read in the user's own timezone, captured from their browser when they save.
export interface PrimerSchedule {
  tz: string;            // IANA zone, e.g. 'Asia/Seoul'
  times: string[];       // 'HH:MM' clock times; empty = "whenever no window is open"
  from: string | null;   // 'HH:MM' start of the allowed range (null with `to` = all day)
  to: string | null;     // 'HH:MM' end, exclusive
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_TIMES = 12;

function validTz(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Body → schedule, or null when the caller sent nothing usable (which means "continuous").
export function sanitizeSchedule(raw: any): PrimerSchedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const tz = typeof raw.tz === 'string' && validTz(raw.tz) ? raw.tz : 'UTC';
  const times: string[] = Array.isArray(raw.times)
    ? [...new Set<string>(raw.times.map(String).filter((x: string) => HHMM.test(x)))].sort().slice(0, MAX_TIMES)
    : [];
  const from = typeof raw.from === 'string' && HHMM.test(raw.from) ? raw.from : null;
  const to = typeof raw.to === 'string' && HHMM.test(raw.to) ? raw.to : null;
  // a half-filled range is no range at all
  const range = from && to && from !== to ? { from, to } : { from: null, to: null };
  if (!times.length && !range.from) return null;
  return { tz, times, ...range };
}

export function parseSchedule(json: string | null | undefined): PrimerSchedule | null {
  if (!json) return null;
  try { return sanitizeSchedule(JSON.parse(json)); } catch { return null; }
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

// Minutes since local midnight in `tz`. Falls back to the server clock for an unknown zone.
export function minutesInTz(tz: string, at: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(at));
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h * 60 + m;
  } catch {
    const d = new Date(at);
    return d.getHours() * 60 + d.getMinutes();
  }
}

function inRange(cur: number, from: number, to: number): boolean {
  return from < to ? cur >= from && cur < to : cur >= from || cur < to; // `to < from` wraps midnight
}
function untilMinute(cur: number, target: number): number {
  const d = (target - cur + 1440) % 1440;
  return (d || 1440) * 60_000;
}

// The one question the primer asks: may I open a window right now?
//   null   → yes, go ahead
//   number → no, sleep this many ms and ask again
// ponytail: clock arithmetic in minutes-of-day, so a DST jump can land a wake-up an hour off. Every
// wake-up re-asks, so it self-corrects on the next pass; a real cron library would be the upgrade.
export function waitFor(s: PrimerSchedule | null, at: number, graceMs: number): number | null {
  if (!s) return null;
  const cur = minutesInTz(s.tz, at);
  if (s.from && s.to) {
    const from = toMinutes(s.from), to = toMinutes(s.to);
    if (!inRange(cur, from, to)) return untilMinute(cur, from);
  }
  if (!s.times.length) return null;
  const grace = Math.ceil(Math.max(0, graceMs) / 60_000);
  const mins = s.times.map(toMinutes).sort((a, b) => a - b);
  // due while the clock is still within `grace` of a listed time — covers a restart, a retry after a
  // failed prime, and timer drift, without letting a missed slot fire hours later
  if (mins.some((m) => (cur - m + 1440) % 1440 <= grace)) return null;
  return untilMinute(cur, mins.find((m) => m > cur) ?? mins[0]);
}
