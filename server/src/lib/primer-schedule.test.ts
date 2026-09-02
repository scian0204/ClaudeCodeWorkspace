import assert from 'node:assert';
import { sanitizeSchedule, waitFor, minutesInTz, MAX_TIMES } from './primer-schedule.js';

const GRACE = 30 * 60_000;
// a fixed instant, read in a fixed zone: 2026-09-03T00:30:00Z = 09:30 in Asia/Seoul
const AT = Date.parse('2026-09-03T00:30:00Z');
assert.equal(minutesInTz('Asia/Seoul', AT), 9 * 60 + 30);
assert.equal(minutesInTz('UTC', AT), 30);

// no schedule = continuous, exactly as before
assert.equal(waitFor(null, AT, GRACE), null);

// half a range is no range; nothing usable at all stays null
assert.equal(sanitizeSchedule({ tz: 'Asia/Seoul', from: '09:00' }), null);
assert.equal(sanitizeSchedule({ times: ['nope'] }), null);
assert.equal(sanitizeSchedule({ tz: 'Not/AZone', times: ['09:00'] })!.tz, 'UTC');
assert.deepEqual(sanitizeSchedule({ times: ['09:00', '09:00', '08:00'] })!.times, ['08:00', '09:00']);
assert.equal(sanitizeSchedule({ times: Array.from({ length: 30 }, (_, i) => `${String(i % 24).padStart(2, '0')}:00`) })!.times.length, MAX_TIMES);

// range only: inside → go, outside → sleep until it opens
const range = sanitizeSchedule({ tz: 'Asia/Seoul', from: '09:00', to: '19:00' })!;
assert.equal(waitFor(range, AT, GRACE), null);
const night = sanitizeSchedule({ tz: 'UTC', from: '09:00', to: '19:00' })!; // 00:30 UTC
assert.equal(waitFor(night, AT, GRACE), (9 * 60 - 30) * 60_000);
// a range that wraps midnight covers 00:30
const wrap = sanitizeSchedule({ tz: 'UTC', from: '22:00', to: '06:00' })!;
assert.equal(waitFor(wrap, AT, GRACE), null);

// times: due within grace after a listed time, otherwise sleep to the next one
const times = sanitizeSchedule({ tz: 'Asia/Seoul', times: ['09:00', '14:00'] })!;
assert.equal(waitFor(times, AT, GRACE), null);                    // 09:30, 30min after 09:00
assert.equal(waitFor(times, AT, 10 * 60_000), (14 * 60 - 9 * 60 - 30) * 60_000); // grace 10min → next slot
// last slot of the day wraps to the first slot tomorrow
const late = sanitizeSchedule({ tz: 'UTC', times: ['00:00'] })!;  // now 00:30 UTC, grace 10min
assert.equal(waitFor(late, AT, 10 * 60_000), 23.5 * 60 * 60_000);

// both: the range gates the times
const both = sanitizeSchedule({ tz: 'UTC', times: ['00:15'], from: '09:00', to: '19:00' })!;
assert.equal(waitFor(both, AT, GRACE), (9 * 60 - 30) * 60_000);

console.log('primer-schedule: ok');
