// Runnable check (no framework): npx tsx server/src/lib/session-export.test.ts
//
// The bundle's two load-bearing claims:
//   1. the exclude list really keeps regenerable dirs (node_modules & co) out — at the top level AND
//      nested, on GNU tar and on bsdtar (a Windows/macOS dev box), which match patterns differently
//   2. the transcript lands at `.claude/projects/<slug>/<uuid>.jsonl` inside the archive, which is
//      the whole point: put that folder in $HOME and `claude --resume <uuid>` finds the session
// It runs the real system tar and reads the member list back, so a portability slip fails here.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { excludeArgs, measureDir, bundleStream, bundleFilename, transcriptLines } from './session-export.js';

const EXCLUDES = ['node_modules', '.cache'];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccw-bundle-test-'));
const proj = path.join(root, 'my-project');
const w = (rel: string, body: string) => {
  const full = path.join(proj, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
};
w('app.ts', 'x'.repeat(100));
w('src/deep/util.ts', 'y'.repeat(50));
w('node_modules/junk.js', 'z'.repeat(10_000));
w('src/node_modules/nested-junk.js', 'z'.repeat(10_000));
w('.cache/blob.bin', 'z'.repeat(10_000));

// ── measureDir ──
const m = measureDir(proj, EXCLUDES, 1024 * 1024);
assert.equal(m.bytes, 150, 'only the two real files count (excludes skipped)');
assert.equal(m.files, 2, 'file count skips excluded trees');
assert.equal(m.over, false, 'well under the cap');
assert.equal(measureDir(proj, EXCLUDES, 100).over, true, 'over the cap once past limitBytes');
assert.equal(measureDir(proj, [], 1024 * 1024).files, 5, 'no excludes → every file counts');

// ── excludeArgs ──
assert.deepEqual(excludeArgs(['node_modules']), ['--exclude=node_modules', '--exclude=*/node_modules'],
  'both anchored and nested pattern forms, for GNU tar and bsdtar');

// ── bundleFilename ──
assert.equal(bundleFilename('Refactor the Auth!', new Date(2026, 7, 20, 15, 4)), 'ccw-refactor-the-auth-20260820-1504.tgz');
assert.equal(bundleFilename('한글 제목', new Date(2026, 7, 20, 15, 4)), 'ccw-20260820-1504.tgz', 'a title with no ASCII left just drops out');

// ── transcriptLines ──
const jsonlFile = path.join(root, 't.jsonl');
fs.writeFileSync(jsonlFile, `${JSON.stringify({ type: 'user', cwd: '/data/users/u1/projects/my-project', sessionId: 'u-1' })}\n`);
const lines = transcriptLines(jsonlFile, 'u-1', 'C:\\dev\\my-project', 'My chat');
assert.match(lines[0], /"custom-title"/, 'the workspace title is prepended for the resume picker');
assert.match(lines[1], /dev/, 'cwd rewritten to the local path');
assert.equal(transcriptLines(jsonlFile, 'u-1', '', null).length, 2, 'no title line, no rewrite → file as-is');

// ── bundleStream ──
const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const { stream } = bundleStream({
  projectDir: proj,
  excludes: EXCLUDES,
  transcript: { slug: '-C--dev-my-project', uuid, lines: ['{"type":"user"}'] },
});
const out = path.join(root, 'bundle.tgz');
const chunks: Buffer[] = [];
stream.on('data', (c: Buffer) => chunks.push(c));
await new Promise<void>((res, rej) => { stream.on('end', () => res()); stream.on('error', rej); });
fs.writeFileSync(out, Buffer.concat(chunks));
// listed with a bare name from `root`: GNU tar reads `C:\…` as a remote host spec ("Cannot connect to C")
const members = execFileSync('tar', ['-tzf', 'bundle.tgz'], { cwd: root, encoding: 'utf8' }).split('\n').map((l) => l.trim().replace(/\/$/, '')).filter(Boolean);

assert.ok(members.includes('my-project/app.ts'), 'project files are under the folder name');
assert.ok(members.includes('my-project/src/deep/util.ts'), 'nested project files kept');
assert.ok(members.includes(`.claude/projects/-C--dev-my-project/${uuid}.jsonl`), 'transcript filed where the CLI looks for it');
assert.ok(!members.some((x) => x.includes('node_modules')), `node_modules excluded at every depth — got ${members.join(' ')}`);
assert.ok(!members.some((x) => x.includes('.cache')), '.cache excluded');

fs.rmSync(root, { recursive: true, force: true });
console.log('session-export: ok');
