// Runnable check (no framework): npx tsx server/src/usage/spend.test.ts
// Needs a built better-sqlite3 binding; on a host without one run it in the app container:
//   docker compose exec app npx tsx server/src/usage/spend.test.ts
// spendSummary is what an API-key session shows instead of plan windows, so the scoping has to be
// exact: the session total counts EVERY author's turns in that session, the rolling windows count
// only the asking user's, and rows older than the window are excluded.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-test-'));
process.env.DATA_DIR = dir; // must be set before db/index.ts opens app.db

const dbMod = await import('../db/index.js');
const { schema } = dbMod;
dbMod.initDb(); // populates the exported `db` live binding tracker.ts reads
const { db } = dbMod;
const { recordUsage, spendSummary } = await import('./tracker.js');

const HOUR = 60 * 60 * 1000;
// age a row by its (unique here) input-token count — ids are random, so row order is not reliable
const age = (inputTokens: number, ms: number) =>
  db.update(schema.usage).set({ createdAt: Date.now() - ms })
    .where(eq(schema.usage.inputTokens, inputTokens)).run();

// two authors in the same (room) session + my turns in another session
recordUsage({ userId: 'me', sessionId: 's1', inputTokens: 100, outputTokens: 10, costUsd: 0.5 });
recordUsage({ userId: 'you', sessionId: 's1', inputTokens: 200, outputTokens: 20, costUsd: 1 });
recordUsage({ userId: 'me', sessionId: 's2', inputTokens: 400, outputTokens: 40, costUsd: 2 });
// mine, but aged out below: 6h ago (out of 5h, in 7d) and 8d ago (out of both)
recordUsage({ userId: 'me', sessionId: 's2', inputTokens: 1000, outputTokens: 100, costUsd: 4 });
recordUsage({ userId: 'me', sessionId: 's2', inputTokens: 9999, outputTokens: 999, costUsd: 99 });
age(1000, 6 * HOUR);
age(9999, 8 * 24 * HOUR);

const s = spendSummary('me', 's1');
// session: both authors, nothing from s2
assert.equal(s.session.turns, 2);
assert.equal(s.session.inputTokens, 300);
assert.equal(s.session.costUsd, 1.5);
// 5h window: only my two fresh turns (s1 + s2); the 6h and 8d rows drop out
assert.equal(s.fiveHour.turns, 2);
assert.equal(s.fiveHour.inputTokens, 500);
assert.equal(s.fiveHour.costUsd, 2.5);
// 7d window: adds the 6h-old row, still excludes the 8d one and never counts 'you'
assert.equal(s.sevenDay.turns, 3);
assert.equal(s.sevenDay.inputTokens, 1500);
assert.equal(s.sevenDay.costUsd, 6.5);

// no turns → zeros, not null/NaN (the popover formats these figures directly)
const empty = spendSummary('nobody', 'nope');
assert.deepEqual(empty.session, { inputTokens: 0, outputTokens: 0, costUsd: 0, turns: 0 });

fs.rmSync(dir, { recursive: true, force: true });
console.log('spend: ok');
