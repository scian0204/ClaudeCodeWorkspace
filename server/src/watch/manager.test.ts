// Runnable check (no framework): npx tsx server/src/watch/manager.test.ts
import assert from 'node:assert';
import { ignoredPath, fillPlaceholders, WATCH_MODES } from './manager.js';

// ── what a notice must never be about ──
// A build or an install rewrites thousands of paths under these; one of them slipping through turns
// the feature into a firehose (and, in 'prompt' mode, into unattended turns).
for (const p of ['node_modules/react/index.js', '.git/HEAD', 'web/dist/assets/x.js',
  'server/target/debug/x', 'a/__pycache__/b.pyc', 'src/app.ts.swp', 'src/app.ts~', 'src/.#app.ts']) {
  assert.ok(ignoredPath(p), `should ignore ${p}`);
}
for (const p of ['src/app.ts', 'README.md', 'a/b/c.py', 'distinct/file.ts', 'my.git.notes.md']) {
  assert.ok(!ignoredPath(p), `should NOT ignore ${p}`);
}

// ── the stored prompt's placeholders ──
const out = fillPlaceholders('{count} changed in {project}:\n{files}', ['a.ts', 'b.ts'], 5, 'api');
assert.equal(out, '5 changed in api:\na.ts\nb.ts');
// a prompt with no placeholders is sent verbatim, and an empty template stays empty (never sent)
assert.equal(fillPlaceholders('run the tests', ['a'], 1, 'p'), 'run the tests');
assert.equal(fillPlaceholders('', ['a'], 1, 'p'), '');
// every placeholder occurrence is filled, not just the first
assert.equal(fillPlaceholders('{count}/{count}', [], 2, 'p'), '2/2');

assert.deepEqual([...WATCH_MODES], ['off', 'notify', 'prompt']);

console.log('watch/manager: ok');
